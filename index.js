const axios = require('axios');
const nodemailer = require('nodemailer')
const fs = require('fs');

const apiUrl = process.env["API_URL"]
const apiPassword = process.env["API_PASSWORD"]

const cachedIds = new Set();
if (fs.existsSync("files/message_ids.json")) {
    console.log("recreating message_id set")
    let ids = JSON.parse(fs.readFileSync('files/message_ids.json'));
    ids.forEach(element => cachedIds.add(element))
}

const transporter = nodemailer.createTransport({
    host: 'mail.gahr.dev',
    port: process.env["SMTP_PORT"],
    auth: {
        user: process.env["SMTP_USER"],
        pass: process.env["SMTP_PASSWORD"]
    }
});


const getHistory = async () => {
    try {
        const response = await axios.get(apiUrl, {headers: {"password": `${apiPassword}`}});
        return response.data["rows"];
    } catch {
        return [];
    }
}

const onlyRejected = (data) => {
    return data.filter(ele => ele.action === "reject")
}

const onlyNew = (data) => {
    return data.filter(ele => !cachedIds.has(ele["message-id"]))
}

const filterSymbols = (data) => {
    data.forEach(element => {
        element["symbols"] = Object.keys(element["symbols"])
            .filter(key => element["symbols"][key]["score"] > 0)
            .reduce((obj, key) => {
                obj[key] = element["symbols"][key];
                return obj;
            }, {});
    })
    return data;
}

const sendNotification = async data => {
    console.log(`Sending notification for message ${data["message-id"]}`)
    cachedIds.add(data["message-id"])

    let fromMessage = data["sender_mime"];
    if (data["sender_mime"] !== data["sender_smtp"])
        fromMessage = `[${data["sender_smtp"]}] ${data["sender_mime"]}`

    let symbolsMessage = ""
    Object.keys(data["symbols"]).forEach(symbol => {
        symbolsMessage += `<li>${data["symbols"][symbol]["name"]}`
        if (data["symbols"][symbol]["description"])
            symbolsMessage += `: ${data["symbols"][symbol]["description"]}`
        symbolsMessage += "</li>"
    })

    const message = `
This is an automated message to inform you about an email rejection on ${new Date(data["unix_time"] * 1000).toUTCString()}<br>
The mail envelope was sent from ${data["ip"]}, sender ${fromMessage} to ${data["rcpt_smtp"].join(', ')}.<br>
It scored ${Math.round(data["score"])} with a maximum allowed score of 15!<br>
The subject in the mail envelope was: ${data["subject"]}<br><br>

The faulty symbols are:
<ul>
${symbolsMessage}
</ul>`
    // send email
    await transporter.sendMail({
        from: process.env["SENDER"],
        to: process.env["RECIPIENTS"],
        subject: `Email rejection notification from ${fromMessage}`,
        html: message
    });

}

setInterval(async () => {
    const history = filterSymbols(onlyNew(onlyRejected(await getHistory())));
    history.forEach(await sendNotification)
    console.log("Write message_ids to file")
    if (fs.existsSync("files/message_ids.json")) {
        console.log("purge old ids")
        fs.unlinkSync("files/message_ids.json");
    }
    fs.writeFileSync('files/message_ids.json', JSON.stringify(Array.from(cachedIds)));
}, parseInt(process.env["REFRESH"]) * 1000)
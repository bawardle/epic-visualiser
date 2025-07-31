require('dotenv').config();
const express = require("express");
const cors = require("cors");
const ado = require("azure-devops-node-api");

const app = express();
const fs = require('fs');
const logStream = fs.createWriteStream(__dirname + '/server_debug.log', { flags: 'a' });

function logToFile(message) {
    logStream.write(message + '\n');
}

logToFile('Server script started.');
console.log('Server script started.');


const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());
app.use(express.static(".."));

const organizationUrl = 'https://dev.azure.com/Next-Technology';
const projectName = 'HR.Tech';
const token = process.env.ADO_TOKEN;

const orgUrl = organizationUrl;

const authHandler = ado.getPersonalAccessTokenHandler(token);
const connection = new ado.WebApi(orgUrl, authHandler);

app.get("/api/stories", (req, res) => {
    const fs = require("fs");
    fs.readFile("../stories/extract.csv", "utf8", (err, data) => {
        if (err) {
            res.status(500).send("Error reading the file");
            return;
        }
        res.send(data);
    });
});

app.post("/api/userstories", async (req, res) => {    logToFile('Received POST request to /api/userstories');    console.log('Received POST request to /api/userstories');    const { ids } = req.body;    if (!ids || !Array.isArray(ids)) {        logToFile("Error: Invalid request body. 'ids' must be an array of strings.");        return res.status(400).json({ error: "Invalid request body. 'ids' must be an array of strings." });    }    try {        const witApi = await connection.getWorkItemTrackingApi();        const workItems = await witApi.getWorkItems(ids.map(id => parseInt(id)), undefined, undefined, 4, undefined, projectName);        const userStories = workItems.map(item => {            const relations = item.relations || [];            logToFile(`Processing story ${item.id}. Relations: ${JSON.stringify(relations)}`);            const precursorRelations = relations.filter(r => r.rel === "System.LinkTypes.Dependency-Reverse");
            logToFile(`Story ${item.id}: Precursor Relations: ${JSON.stringify(precursorRelations)}`);
            const precursorIds = precursorRelations.map(p => p.url.split('/').pop());
            logToFile(`Story ${item.id}: Precursor IDs: ${JSON.stringify(precursorIds)}`);

            const successorRelations = relations.filter(r => r.rel === "System.LinkTypes.Dependency-Forward");
            logToFile(`Story ${item.id}: Successor Relations: ${JSON.stringify(successorRelations)}`);            const successorIds = successorRelations.map(s => s.url.split('/').pop());            return {                Id: item.id.toString(),                Name: item.fields["System.Title"],                State: item.fields["System.State"],                Iteration: item.fields["System.IterationPath"],                Precursor: precursorIds,                Successor: successorIds,                "Critical-Pathway": successorIds.length >= 2,                "Connected-Stories": successorIds.length            };        });        res.json({ user_stories: userStories });    } catch (error) {        console.error(error);        logToFile(`Error in /api/userstories: ${error.message}\nStack: ${error.stack}`);        res.status(500).json({ error: "Failed to fetch user stories from Azure DevOps." });    }}) 

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
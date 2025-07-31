require('dotenv').config();
const express = require("express");
const cors = require("cors");
const ado = require("azure-devops-node-api");

const app = express();
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

app.post("/api/userstories", async (req, res) => {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids)) {
        return res.status(400).json({ error: "Invalid request body. 'ids' must be an array of strings." });
    }

    try {
        const witApi = await connection.getWorkItemTrackingApi();
        const workItems = await witApi.getWorkItems(ids.map(id => parseInt(id)), undefined, undefined, 4, undefined, projectName);

        const userStories = workItems.map(item => {
            const relations = item.relations || [];
            const predecessor = relations.find(r => r.rel === "System.LinkTypes.Dependency-Reverse" && r.attributes.name === "Predecessor");
            const successor = relations.find(r => r.rel === "System.LinkTypes.Dependency-Forward" && r.attributes.name === "Successor");

            return {
                Id: item.id.toString(),
                Name: item.fields["System.Title"],
                State: item.fields["System.State"],
                Iteration: item.fields["System.IterationPath"],
                Precursor: predecessor ? predecessor.url.split('/').pop() : null,
                Successor: successor ? successor.url.split('/').pop() : null,
            };
        });

        res.json({ user_stories: userStories });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch user stories from Azure DevOps." });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
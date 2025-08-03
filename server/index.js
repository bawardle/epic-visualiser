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

app.post("/api/epichierarchy", async (req, res) => {
    logToFile('Received POST request to /api/epichierarchy');
    console.log('Received POST request to /api/epichierarchy');
    const { epicId } = req.body;
    if (!epicId) {
        logToFile("Error: Invalid request body. 'epicId' is required.");
        return res.status(400).json({ error: "Invalid request body. 'epicId' is required." });
    }

    try {
        const witApi = await connection.getWorkItemTrackingApi();

        // Step 1: Get the main epic
        const epicWorkItem = await witApi.getWorkItem(parseInt(epicId), ["System.Id", "System.Title", "System.State", "System.WorkItemType", "Microsoft.VSTS.Scheduling.Effort", "Custom.TShirtSize"]);
        
        const allIds = new Set([epicWorkItem.id]);
        const relations = [];

        // Step 2: Get direct children of the epic (Features)
        const featureLinks = await witApi.queryByWiql({ query: `SELECT [System.Id] FROM WorkItemLinks WHERE [Source].[System.Id] = ${epicId} AND [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward' AND [Target].[System.WorkItemType] = 'Feature' MODE (MustContain)` }, projectName);

        if (featureLinks.workItemRelations.length > 0) {
            const featureIds = featureLinks.workItemRelations.map(rel => rel.target.id);
            featureIds.forEach(id => allIds.add(id));
            relations.push(...featureLinks.workItemRelations);
        }

        // Step 4: Fetch all work items in one call
        const workItems = await witApi.getWorkItems(Array.from(allIds), ["System.Id", "System.Title", "System.State", "System.WorkItemType", "Microsoft.VSTS.Scheduling.Effort", "Custom.TShirtSize"]);

        const workItemsMap = new Map(workItems.map(item => [item.id, {
            Id: item.id.toString(),
            Name: item.fields["System.Title"],
            State: item.fields["System.State"],
            WorkItemType: item.fields["System.WorkItemType"],
            Effort: item.fields["Microsoft.VSTS.Scheduling.Effort"] || 0,
            TShirtSize: item.fields["Custom.TshirtSize"],
            children: []
        }]));

        // Step 5: Build the hierarchy
        relations.forEach(rel => {
            if (rel.source && rel.target) {
                const sourceNode = workItemsMap.get(rel.source.id);
                const targetNode = workItemsMap.get(rel.target.id);
                if (sourceNode && targetNode) {
                    sourceNode.children.push(targetNode);
                }
            }
        });

        const root = workItemsMap.get(epicWorkItem.id);
        if (root) {
            res.json(root);
        } else {
            res.status(404).json({ error: "Epic not found or hierarchy could not be constructed." });
        }

    } catch (error) {
        console.error(error);
        logToFile(`Error in /api/epichierarchy: ${error.message}\nStack: ${error.stack}`);
        res.status(500).json({ error: "Failed to fetch epic hierarchy from Azure DevOps." });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
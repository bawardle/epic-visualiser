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

const BATCH_SIZE = 200;

async function getWorkItemsInBatches(witApi, ids) {
    let workItems = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = ids.slice(i, i + BATCH_SIZE);
        const batchWorkItems = await witApi.getWorkItems(batch, ["System.Id", "System.Title", "System.State", "System.WorkItemType", "Microsoft.VSTS.Scheduling.Effort", "Custom.TShirtSize", "Microsoft.VSTS.Scheduling.StoryPoints"]);
        workItems = workItems.concat(batchWorkItems);
    }
    return workItems;
}

app.post("/api/initiativehierarchy", async (req, res) => {
    const { initiativeId } = req.body;
    if (!initiativeId) {
        return res.status(400).json({ error: "Invalid request body. 'initiativeId' is required." });
    }

    try {
        const witApi = await connection.getWorkItemTrackingApi();

        // Step 1: Get the main initiative
        const initiativeWorkItem = await witApi.getWorkItem(parseInt(initiativeId), ["System.Id", "System.Title", "System.State", "System.WorkItemType", "Microsoft.VSTS.Scheduling.Effort", "Custom.TShirtSize", "Microsoft.VSTS.Scheduling.StoryPoints"]);

        if (!initiativeWorkItem) {
            return res.status(404).json({ error: `Initiative with ID '${initiativeId}' not found.` });
        }
        
        const allIds = new Set([initiativeWorkItem.id]);
        const relations = [];

        // Step 2: Get direct children of the initiative (Epics)
        const epicLinks = await witApi.queryByWiql({ query: `SELECT [System.Id] FROM WorkItemLinks WHERE [Source].[System.Id] = ${initiativeId} AND [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward' AND [Target].[System.WorkItemType] = 'Epic' MODE (MustContain)` }, projectName);

        if (epicLinks.workItemRelations.length > 0) {
            const epicIds = epicLinks.workItemRelations.map(rel => rel.target.id);
            epicIds.forEach(id => allIds.add(id));
            relations.push(...epicLinks.workItemRelations);

            // Step 3: For each epic, get its children (Features)
            for (const epicId of epicIds) {
                const featureLinks = await witApi.queryByWiql({ query: `SELECT [System.Id] FROM WorkItemLinks WHERE [Source].[System.Id] = ${epicId} AND [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward' AND [Target].[System.WorkItemType] = 'Feature' MODE (MustContain)` }, projectName);
                if (featureLinks.workItemRelations.length > 0) {
                    const featureIds = featureLinks.workItemRelations.map(rel => rel.target.id);
                    featureIds.forEach(id => allIds.add(id));
                    relations.push(...featureLinks.workItemRelations);

                    // Step 4: For each feature, get its children (User Stories)
                    for (const featureId of featureIds) {
                        const userStoryLinks = await witApi.queryByWiql({ query: `SELECT [System.Id] FROM WorkItemLinks WHERE [Source].[System.Id] = ${featureId} AND [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward' AND [Target].[System.WorkItemType] = 'User Story'` }, projectName);
                        if (userStoryLinks.workItemRelations.length > 0) {
                            const userStoryIds = userStoryLinks.workItemRelations.map(rel => rel.target.id);
                            userStoryIds.forEach(id => allIds.add(id));
                            relations.push(...userStoryLinks.workItemRelations);
                        }
                    }
                }
            }
        }

        // Step 5: Fetch all work items in one call
        const workItems = await getWorkItemsInBatches(witApi, Array.from(allIds));

        const workItemsMap = new Map(workItems.map(item => [item.id, {
            Id: item.id.toString(),
            Name: item.fields["System.Title"],
            State: item.fields["System.State"],
            WorkItemType: item.fields["System.WorkItemType"],
            Effort: item.fields["Microsoft.VSTS.Scheduling.Effort"] || 0,
            TShirtSize: item.fields["Custom.TshirtSize"],
            StoryPoints: item.fields["Microsoft.VSTS.Scheduling.StoryPoints"] || 0,
            children: []
        }]));

        // Step 6: Build the hierarchy
        relations.forEach(rel => {
            if (rel.source && rel.target) {
                const sourceNode = workItemsMap.get(rel.source.id);
                const targetNode = workItemsMap.get(rel.target.id);
                if (sourceNode && targetNode) {
                    sourceNode.children.push(targetNode);
                }
            }
        });

        const root = workItemsMap.get(initiativeWorkItem.id);
        if (root) {
            res.json(root);
        } else {
            res.status(404).json({ error: "Initiative not found or hierarchy could not be constructed." });
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch initiative hierarchy from Azure DevOps." });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
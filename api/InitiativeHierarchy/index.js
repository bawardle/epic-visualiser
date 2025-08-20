const ado = require("azure-devops-node-api");

const organizationUrl = 'https://dev.azure.com/Next-Technology';
const projectName = 'HR.Tech';
const token = process.env.ADO_TOKEN; // This will be read from Azure configuration

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

module.exports = async function (context, req) {
    const { initiativeId } = req.body;
    if (!initiativeId) {
        context.res = {
            status: 400,
            body: { error: "Invalid request body. 'initiativeId' is required." }
        };
        return;
    }

    try {
        const authHandler = ado.getPersonalAccessTokenHandler(token);
        const connection = new ado.WebApi(organizationUrl, authHandler);
        const witApi = await connection.getWorkItemTrackingApi();

        // Step 1: Get the main initiative
        const initiativeWorkItem = await witApi.getWorkItem(parseInt(initiativeId), ["System.Id", "System.Title", "System.State", "System.WorkItemType"]);

        if (!initiativeWorkItem) {
            context.res = {
                status: 404,
                body: { error: `Initiative with ID '${initiativeId}' not found.` }
            };
            return;
        }
        
        const allIds = new Set([initiativeWorkItem.id]);
        const relations = [];

        // Recursive function to get all children
        async function getChildren(parentId, parentType) {
            let childType;
            switch (parentType) {
                case 'Initiative': childType = 'Epic'; break;
                case 'Epic': childType = 'Feature'; break;
                case 'Feature': childType = 'User Story'; break;
                case 'User Story': childType = 'Task'; break;
                default: return; // No more children
            }
        
            const query = `SELECT [System.Id] FROM WorkItemLinks WHERE [Source].[System.Id] = ${parentId} AND [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward' AND [Target].[System.WorkItemType] = '${childType}' MODE (MustContain)`;
            const links = await witApi.queryByWiql({ query }, projectName);
        
            if (links.workItemRelations.length > 0) {
                const childIds = links.workItemRelations.map(rel => rel.target.id);
                childIds.forEach(id => allIds.add(id));
                relations.push(...links.workItemRelations);
        
                for (const childId of childIds) {
                    await getChildren(childId, childType);
                }
            }
        }
        
        await getChildren(initiativeWorkItem.id, 'Initiative');

        // Step 5: Fetch all work items in batches
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

        // Recursive function to calculate percentages
        function calculateCompletion(node) {
            if (!node || !node.children || node.children.length === 0) {
                // For a User Story, its completion is based on its own state
                if (node.WorkItemType === 'User Story') {
                    const isComplete = (node.State === 'Ready for Test' || node.State === 'Closed');
                    return { total: node.StoryPoints, completed: isComplete ? node.StoryPoints : 0 };
                }
                return { total: 0, completed: 0 };
            }

            let totalStoryPoints = 0;
            let completedStoryPoints = 0;

            node.children.forEach(child => {
                const childStats = calculateCompletion(child);
                totalStoryPoints += childStats.total;
                completedStoryPoints += childStats.completed;
            });
            
            node.devCompletePercentage = totalStoryPoints > 0 ? (completedStoryPoints / totalStoryPoints) * 100 : 0;
            
            // If the node itself is a User Story (e.g., a Feature with children User Stories)
            if (node.WorkItemType === 'User Story') {
                 totalStoryPoints += node.StoryPoints;
                 if (node.State === 'Ready for Test' || node.State === 'Closed') {
                     completedStoryPoints += node.StoryPoints;
                 }
            }

            return { total: totalStoryPoints, completed: completedStoryPoints };
        }
        
        calculateCompletion(root);

        if (root) {
            context.res = {
                status: 200,
                body: root
            };
        } else {
            context.res = {
                status: 404,
                body: { error: "Initiative not found or hierarchy could not be constructed." }
            };
        }

    } catch (error) {
        context.log.error(error); // Use context.log for logging in Azure Functions
        context.res = {
            status: 500,
            body: { error: "Failed to fetch initiative hierarchy from Azure DevOps." }
        };
    }
};
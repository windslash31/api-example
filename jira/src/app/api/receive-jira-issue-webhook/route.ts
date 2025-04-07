import { generateBBToken, fetchData, createBBIssueWorkflow, updateJiraIssueAfterBBIssueCreated } from '../utils';

interface JiraWebhookPayload {
  webhookEvent: string;
  issue_event_type_name: string;
  issue: {
    key: string;
    fields: {
      issuetype: {
        name: string;
      };
      project: {
        key: string;
      };
      summary: string;
      description: string;
      customfield_10236: string; // SQL statement
      customfield_10235: string; // Database name
      customfield_10268: string; // Bytebase issue link
      status: {
        name: string;
      };
    };
  };
}

interface ParsedData {
  issueKey: string;
  issueType: string;
  projectKey: string;
  summary: string;
  description: string;
  sqlStatement: string;
  database: string;
  status: string;
  bytebaseIssueLink: string;
}

interface BytebaseDatabase {
  name: string;
  environment: string;
}

export async function POST(request: Request) {
  //  console.log(`${request.method} request received`, request);

    try {
        const body: JiraWebhookPayload = await request.json();
     //   console.log('Received payload:', JSON.stringify(body));

        const issueType = body.issue.fields.issuetype.name;
        if (issueType !== 'Database Change') {
            return Response.json({ error: 'Not a Database Change issue' }, { status: 400 });
        }

        const projectKey = body.issue.fields.project.key;
        if (projectKey !== process.env.NEXT_PUBLIC_JIRA_PROJECT_KEY) {
            return Response.json({ error: 'Not the Configured Jira Project' }, { status: 400 });
        }

        const issueKey = body.issue.key;
        const summary = body.issue.fields.summary;
        const description = body.issue.fields.description;
        const sqlStatement = body.issue.fields.customfield_10236;
        const database = body.issue.fields.customfield_10235;
        const status = body.issue.fields.status.name;
        let bytebaseIssueLink = body.issue.fields.customfield_10268;

        const parsedData: ParsedData = {
            issueKey,
            issueType,
            projectKey,
            summary,
            description,
            sqlStatement,
            database,
            status,
            bytebaseIssueLink,
        };

        // Check if this is a new issue creation
        if (body.webhookEvent === "jira:issue_created" && body.issue_event_type_name === "issue_created") {

            // Create Bytebase issue
            const token = await generateBBToken();

            // Fetch databases for the matching project
            const databasesData = await fetchData(`${process.env.NEXT_PUBLIC_BB_HOST}/v1/${process.env.NEXT_PUBLIC_BB_PROJECT_NAME}/databases`, token);
            
            // Find matching database
            const matchingDatabase = databasesData.databases.find((db: BytebaseDatabase) => db.name.split('/').pop() === database);
            if (!matchingDatabase) {
                return Response.json({ error: 'No matching Bytebase database found' }, { status: 400 });
            }

            // Create Bytebase issue
            const result = await createBBIssueWorkflow(process.env.NEXT_PUBLIC_BB_PROJECT_NAME, matchingDatabase, sqlStatement, summary, description, issueKey);
            
            if (result.success && result.issueLink) {
                bytebaseIssueLink = result.issueLink;
                parsedData.bytebaseIssueLink = bytebaseIssueLink;

                try {
                    // Update Jira issue with Bytebase link and set status to "In Progress"
                    await updateJiraIssueAfterBBIssueCreated(issueKey, bytebaseIssueLink);
                } catch (error) {
                    console.error('Error updating Jira issue:', error);
                    return Response.json({ error: 'Failed to update Jira issue', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
                }
            } else {
                return Response.json({ error: 'Failed to create Bytebase issue', details: result.message }, { status: 500 });
            }
            // Store the parsed data in a global variable for both create and update events
            global.lastJiraWebhook = parsedData;
        } else if (body.webhookEvent === "jira:issue_updated") {
            // Handle issue update
            console.log("Jira issue updated:", issueKey);
            // You might want to perform additional actions here for issue updates
            // Store the parsed data in a global variable for both create and update events
            global.lastJiraWebhook = parsedData;
        }

        return Response.json({ message: 'Webhook received and processed successfully', data: parsedData });
    } catch (error) {
        console.error('Error processing webhook:', error);
        return Response.json({ error: 'Error processing webhook' }, { status: 500 });
    }
}

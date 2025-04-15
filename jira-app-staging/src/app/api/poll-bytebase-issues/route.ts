import { updateJiraIssueStatus, generateBBToken } from '../utils';

interface BytebaseIssue {
    name: string;
    title: string;
    status: string;
    type: string;
    description: string;
    project: {
        id: number;
        name: string;
    };
}

interface ParsedBytebaseData {
    issueName: string;
    issueTitle: string;
    issueStatus: string;
    issueType: string;
    issueDescription: string;
    projectName: string;
    bytebaseIssueLink: string;
    jiraIssueKey: string | null;
}

// Store the last processed issue IDs and their statuses`
const processedIssues = new Map<string, string>();

export async function GET() {

    try {
        // Generate BB token
        const token = await generateBBToken();

        // Fetch all projects
        const projectsResponse = await fetch(`${process.env.NEXT_PUBLIC_BB_HOST}/v1/projects`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        if (!projectsResponse.ok) {
            throw new Error(`Failed to fetch Bytebase projects: ${projectsResponse.statusText}`);
        }

        const projectsData = await projectsResponse.json();
        const projects = projectsData.projects || [];
        const updatedIssues: ParsedBytebaseData[] = [];

        for (const project of projects) {
            let projectName = project.name;
            // Remove leading "projects/" if present to avoid duplicated path segment
            if (projectName.startsWith('projects/')) {
                projectName = projectName.substring('projects/'.length);
            }
            // Fetch issues for each project
            const issuesResponse = await fetch(`${process.env.NEXT_PUBLIC_BB_HOST}/v1/projects/${projectName}/issues`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            if (!issuesResponse.ok) {
                console.error(`Failed to fetch issues for project ${projectName}: ${issuesResponse.statusText}`);
                continue;
            }

            const issuesData = await issuesResponse.json();
            const issues = issuesData.issues || [];

            for (const issue of issues) {
                const jiraIssueKeyMatch = issue.title.match(/\[JIRA>([^\]]+)\]/);
                const jiraIssueKey = jiraIssueKeyMatch ? jiraIssueKeyMatch[1] : null;

                // Skip if no Jira issue is linked
                if (!jiraIssueKey) continue;

                // Skip if we've already processed this issue with the same status
                const lastStatus = processedIssues.get(issue.name);
                if (lastStatus === issue.status) continue;

                // Update the processed issues map
                processedIssues.set(issue.name, issue.status);

                let jiraStatus;
                if (issue.status === "DONE") {
                    jiraStatus = "Done";
                } else if (issue.status === "OPEN") {
                    jiraStatus = "In Progress";
                }

                if (jiraStatus) {
                    try {
                        await updateJiraIssueStatus(jiraIssueKey, jiraStatus);
                        console.log(`Updated Jira issue ${jiraIssueKey} status to ${jiraStatus}`);

                        const parsedData: ParsedBytebaseData = {
                            issueName: issue.name,
                            issueTitle: issue.title,
                            issueStatus: issue.status,
                            issueType: issue.type,
                            issueDescription: issue.description,
                            projectName: projectName,
                            bytebaseIssueLink: `${process.env.NEXT_PUBLIC_BB_HOST}/${issue.name}`,
                            jiraIssueKey,
                        };

                        updatedIssues.push(parsedData);
                    } catch (error) {
                        console.error(`Failed to update Jira issue ${jiraIssueKey} status:`, error);
                    }
                }
            }
        }

        return Response.json({ updatedIssues });
    } catch (error) {
        console.error('Error processing webhook:', error);
        return Response.json({ error: 'Error processing webhook' }, { status: 500 });
    }
}

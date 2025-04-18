import exp from 'constants';
import { v4 } from 'uuid';

export interface BytebaseDatabase {
    name: string;
    environment: string;
}

export async function fetchData(url: string, token: string, options: RequestInit = {}) {
    const defaultOptions: RequestInit = {
        method: "GET",
        headers: {
            'Content-Type': 'application/json',
            "Authorization": 'Bearer ' + token
        },
        cache: 'no-store'
    };

    const mergedOptions = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...options.headers
        }
    };

    const response = await fetch(url, mergedOptions);
    return response.json();
}

/* Generate token */ 
export async function generateBBToken() {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BB_HOST}/v1/auth/login`, {
        method: "POST",
        body: JSON.stringify({
            "email": process.env.NEXT_PUBLIC_BB_SERVICE_ACCOUNT,
            "password": process.env.NEXT_PUBLIC_BB_SERVICE_KEY,
            "web": true
        }),
        headers: {
            'Content-Type': 'application/json',
            'Accept-Encoding': 'deflate, gzip',
        },
        cache: 'no-store'
    });

    const token = await res.json();
    return token.token;
}

export async function switchWorkspaceMode() {
    const token = await generateBBToken();
    const response = await fetchData(`${process.env.NEXT_PUBLIC_BB_HOST}/v1/settings/bb.workspace.profile?updateMask=value.workspace_profile_setting_value.database_change_mode`, token, {
        method: 'PATCH',
        body: JSON.stringify({
            "value": { 
                "workspaceProfileSettingValue": {
                    "databaseChangeMode": "EDITOR"
                }
            }
        })
    });
    return response;
}

export async function grantUserRoleProjectOwner(project: string, email: string) {
    const token = await generateBBToken();
    const response = await fetchData(`${process.env.NEXT_PUBLIC_BB_HOST}/v1/projects/${project}:getIamPolicy`, token, {
        method: 'GET'
    });

    console.log("=============getIamPolicy", JSON.stringify(response));

    response.bindings.push({
        "role": "roles/projectOwner",
        "members": [`user:${email}`],
        "condition": {
          "expression": "",
          "title": "",
          "description": "",
          "location": ""
        },
        "parsedExpr": null
      });

    const newResponse = {
        "resource":`projects/${project}`,
        "policy": {bindings: response.bindings},
        "etag": response.etag
    }


    console.log("=============after push", JSON.stringify(newResponse));

    const setResponse = await fetchData(`${process.env.NEXT_PUBLIC_BB_HOST}/v1/projects/${project}:setIamPolicy`, token, {
        method: 'POST',
        body: JSON.stringify(newResponse)
    });

    console.log("=============grantUserRole", setResponse);

    return setResponse;
}

async function createPlan(project: string) {
    const token = await generateBBToken();
    const newPlan = {
        "steps": [
            {
                "specs": [
                    {
                        "id": v4(),
                        "create_database_config": {
                            "target": `instances/test-sample-instance`,
                            "database": project,
                          //  "sheet": sheetName,
                            "owner": "bbsample",
                            "characterSet": `UTF8`
                        }
                    }
                ]
            }
        ],
        "title": `Create database ${project}`,
        "description": "Create a database"
    };

    const response = await fetchData(`${process.env.NEXT_PUBLIC_BB_HOST}/v1/projects/${project}/plans`, token, {
        method: 'POST',
        body: JSON.stringify(newPlan)
    });

    return response;
}

async function createIssue(project: string, planName: string) {
 
    const token = await generateBBToken();
    const newIssue = {
        "approvers": [],
        "approvalTemplates": [],
        "subscribers": [],
        "title": `Create a empty database ${project}`,
        "description": `Create a database`,
        "type": "DATABASE_CHANGE",
        "assignee": "",
        "plan": planName
    };

    console.log("=============success newIssue", newIssue);

    const response = await fetchData(`${process.env.NEXT_PUBLIC_BB_HOST}/v1/projects/${project}/issues`, token, {
        method: 'POST',
        body: JSON.stringify(newIssue)
    });

    return response;
}

async function createRollout(project: string, planName: string) {
    const token = await generateBBToken();
    const newRollout = { "plan": planName };

    const response = await fetchData(`${process.env.NEXT_PUBLIC_BB_HOST}/v1/projects/${project}/rollouts`, token, {
        method: 'POST',
        body: JSON.stringify(newRollout)
    });

    return response;
}

export async function createBBIssueWorkflow(project: string) {

    console.log("=============createIssueWorkflow", project);
    try {
      //  const sheetData = await createSheet(project);
     //   console.log("--------- createdSheetData ----------", sheetData);

      //  const planData = await createPlan(project, sheetData.name);
        const planData = await createPlan(project);
       // console.log("--------- createdPlanData ----------", planData);

        const issueData = await createIssue(project, planData.name);
        console.log("--------- createdIssue ----------", issueData);

        const rolloutData = await createRollout(project, planData.name);
        console.log("--------- createdRollout ----------", rolloutData);
        return {
            success: true,
            database: project
        };
    } catch (error) {
        console.error("Error in createIssueWorkflow:", error);
        return {
            success: false,
            message: "Failed to create issue",
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
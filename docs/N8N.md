# n8n Notes

## Current Status

n8n is optional in this project right now. The browser UI does not call n8n.
The active flow is:

```text
Browser UI -> Express backend -> OpenAI -> Excel
```

The n8n workflow file is:

```text
n8n/cv-auto-upload-bridge.workflow.json
```

It is a bridge workflow that receives an upload and forwards it to the backend
endpoint `/api/process-cvs`.

## What n8n Does Not Do

- It does not store OpenAI credentials.
- It does not parse CVs itself.
- It does not create Excel itself.
- It does not currently handle the primary browser UI upload flow.

## Backend Endpoint Used by n8n

```text
POST /api/process-cvs
```

Required header:

```text
x-workflow-secret: <CV_WORKFLOW_SECRET>
```

The workflow needs to know the public backend URL. In the current workflow JSON,
that value is supplied by request query/header expression, not by backend code.

## If n8n Becomes the Primary Flow Later

Update all of these together:

- `public/app.js`
- `server.js`
- `n8n/cv-auto-upload-bridge.workflow.json`
- `docs/PROJECT_CONTEXT.md`
- `docs/API.md`
- this file

Keep the large-folder rule: uploads must still be one-by-one or queue-based, not
one huge multipart request.

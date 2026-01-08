import crypto from 'crypto';

import express from 'express';

const app = express();
const PORT = 3333;

const SENTRY_CLIENT_SECRET = process.env.SENTRY_CLIENT_SECRET;
const SLASHWORK_AUTH_TOKEN = process.env.SLASHWORK_AUTH_TOKEN;
const SLASHWORK_GROUP_ID = process.env.SLASHWORK_GROUP_ID;
const SLASHWORK_GRAPHQL_URL =
  'http://anserine.dev.anserinelabs.com:5173/api/graphql';

if (!SENTRY_CLIENT_SECRET || !SLASHWORK_AUTH_TOKEN || !SLASHWORK_GROUP_ID) {
  throw new Error('Missing required environment variables');
}

interface RequestWithRawBody extends express.Request {
  rawBody?: string;
}

// Middleware to capture raw body for signature verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as RequestWithRawBody).rawBody = buf.toString('utf8');
    },
  }),
);

interface SentryWebhookPayload {
  action: string;
  data: {
    issue?: {
      title: string;
      web_url: string;
      project: string;
    };
  };
  project_slug?: string;
}

function verifySentrySignature(
  signature: string,
  body: string,
  secret: string,
): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body, 'utf8');
  const digest = hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

interface GraphQLResponse {
  data?: {
    createPost: {
      node: {
        id: string;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

async function postToSlashwork(markdown: string): Promise<void> {
  const mutation = `
    mutation CreatePost($groupId: ID!, $input: CreatePostMutationInput!) {
      createPost(groupId: $groupId, input: $input) {
        node {
          id
        }
      }
    }
  `;

  const variables = {
    groupId: SLASHWORK_GROUP_ID,
    input: {
      markdown,
    },
  };

  const response = await fetch(SLASHWORK_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SLASHWORK_AUTH_TOKEN}`,
    },
    body: JSON.stringify({
      query: mutation,
      variables,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Failed to post to Slashwork:', errorText);
    throw new Error(`Slashwork API error: ${response.status}`);
  }

  const result = (await response.json()) as GraphQLResponse;
  if (result.errors) {
    console.error('GraphQL errors:', result.errors);
    throw new Error('GraphQL mutation failed');
  }

  if (!result.data) {
    throw new Error('No data in GraphQL response');
  }

  console.log(
    'Successfully posted to Slashwork:',
    result.data.createPost.node.id,
  );
}

app.post('/webhook/sentry', (req, res) => {
  const signature = req.headers['sentry-hook-signature'] as string | undefined;
  const rawBody = (req as RequestWithRawBody).rawBody;

  if (!signature) {
    console.error('Missing Sentry signature');
    res.status(401).json({ error: 'Missing signature' });
    return;
  }

  if (!rawBody) {
    console.error('Missing request body');
    res.status(400).json({ error: 'Missing body' });
    return;
  }

  if (!verifySentrySignature(signature, rawBody, SENTRY_CLIENT_SECRET)) {
    console.error('Invalid Sentry signature');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  const payload = req.body as SentryWebhookPayload;

  // Respond to Sentry immediately (they have a 1 second timeout)
  res.status(200).json({ success: true });

  // Process the webhook asynchronously
  void (async () => {
    try {
      const issue = payload.data?.issue;
      if (!issue) {
        console.log('No issue data in webhook, skipping');
        return;
      }

      const markdown = `**Sentry Alert**

**Project:** ${issue.project || payload.project_slug || 'Unknown'}
**Error:** ${issue.title}

[View in Sentry](${issue.web_url})`;

      await postToSlashwork(markdown);
    } catch (error) {
      console.error('Error processing Sentry webhook:', error);
    }
  })();
});

app.listen(PORT, () => {
  console.log(`Sentry webhook server listening on port ${PORT}`);
});

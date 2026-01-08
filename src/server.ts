import crypto from 'crypto';

import express from 'express';

const PORT = 3333;

const SENTRY_CLIENT_SECRET = process.env.SENTRY_CLIENT_SECRET;
const SLASHWORK_AUTH_TOKEN = process.env.SLASHWORK_AUTH_TOKEN;
const SLASHWORK_GROUP_ID = process.env.SLASHWORK_GROUP_ID;
const SLASHWORK_GRAPHQL_URL = 'https://anserine.slashwork.com/api/graphql';

if (!SENTRY_CLIENT_SECRET || !SLASHWORK_AUTH_TOKEN || !SLASHWORK_GROUP_ID) {
  throw new Error('Missing required environment variables');
}

type SentryWebhookPayload = {
  action: string;
  data: {
    triggered_rule: string;
    event: {
      title: string;
      message?: string;
      web_url: string;
    };
  };
};

type GraphQLResponse = {
  data?: {
    createPost: {
      node: {
        id: string;
      };
    };
  };
  errors?: { message: string }[];
};

const verifySentrySignatureMiddleware = express.json({
  verify: (req, _res, buf) => {
    const signature = req.headers['sentry-hook-signature'];

    if (!signature || typeof signature !== 'string') {
      console.error('Missing Sentry signature');
      throw new Error('Missing signature');
    }

    const hmac = crypto.createHmac('sha256', SENTRY_CLIENT_SECRET);
    hmac.update(buf);
    const digest = hmac.digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
      console.error('Invalid Sentry signature');
      throw new Error('Invalid signature');
    }
  },
});

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

async function processPayload(payload: SentryWebhookPayload) {
  try {
    if (payload.action !== 'triggered') {
      console.log('Wrong action type, skipping');
      return;
    }

    const markdown = `# ${payload.data.event.title}

**Message:** ${payload.data.event.message}
**Rule:** ${payload.data.triggered_rule}

[Go to Sentry](${payload.data.event.web_url})`;

    await postToSlashwork(markdown);
  } catch (error) {
    console.error('Error processing Sentry webhook:', error);
  }
}

const app = express();

app.post('/webhook/sentry', verifySentrySignatureMiddleware, (req, res) => {
  res.sendStatus(200);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  void processPayload(req.body);
});

app.listen(PORT, () => {
  console.log(`Sentry webhook server listening on port ${PORT}`);
});

# Slashwork Sentry Integration

This is the integration that Slashwork itself uses to send Sentry events into our own internal Slashwork group. It's released here as example code in case you might find it useful. It currently processes Sentry alert rule notifications (only, nothing else) and then posts those into a group on Slashwork.

You'll need to configure the following in `.env`:

- `SENTRY_CLIENT_SECRET` -- generated as part of the integration below
- `SLASHWORK_AUTH_TOKEN` -- the auth token of a Slashwork app
- `SLASHWORK_GROUP_ID` -- the Slashwork group ID to post into (create a group and grab from the URL)

You'll also need to change `SLASHWORK_GRAPHQL_URL` in `server.ts` to point to your company instead of ours.

The server receives Sentry webhooks, so it needs to be running somewhere with a public DNS domain. On that server, `npm run build` then `npm run server`. The code only speaks HTTP, not HTTPS, so you'll probably also want to change the URL in the `Caddyfile` and then `caddy start` -- or have some other way to terminate TLS and send it to port 3333.

On the Sentry side, go to Settings -> Integrations -> Create New Integration. Create an internal integration, and point the webhook URL at `https://yourserver.example/webhook/sentry`. Turn on "alert rule action". You'll also need to get a client secret for this integration to use as `SENTRY_CLIENT_SECRET`.

Then, under Issues -> Alerts, select an alert rule, and you should be able to add an action to "send a notification via" and select your new itegration from above.

## Claude Code

The code here was written substantially by Claude Code. It's actually really good at using GraphQL introspection to figure out how the Slashwork API works, if you ask it to do so -- you can tell it to use the `SLASHWORK_AUTH_TOKEN` to make introspection requests against the `SLASHWORK_GRAPHQL_URL` in order to figure out how to do things.

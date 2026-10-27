# 08 · Zoho Social scheduler

**Business problem.** WowGlamDecor publishes product pins to Pinterest in batches. Scheduling them one at a time in a web dashboard is slow and error-prone. And a post that silently fails to schedule is a product nobody sees.

**What the code does** (`schedule-posts.mjs`)

- Reads a prepared batch: approved copy, image, link, board and time for each post.
- Calls Zoho Social's `createSocialSchedule` tool through **Zoho's MCP server** (JSON-RPC over HTTPS), authenticated with an OAuth bearer token.
- Paces calls 500 ms apart to respect rate limits, and parses every response down to the Zoho post id.
- Writes three records: a JSON log of what was scheduled, a row per post appended to the master tracker CSV, and per-board CSVs. That way a failed post shows up as a gap, never a silent miss.

Account identifiers and the token location are read from environment variables in this copy.

**Note on the copy:** the script only schedules text that was written and approved per product beforehand. It never generates captions from templates. That rule came from a real batch that read as automated.

# Cloudflare deployment / 云端部署

Live prototype / 当前演示：[storybook.david-widgets.com](https://storybook.david-widgets.com/).

This guide deploys a separate instance in your Cloudflare account. The live production configuration and credentials are excluded from Git.

以下步骤在你自己的 Cloudflare 账户中部署一份实例。仓库不包含线上环境配置或凭据。

## Setup / 首次配置

From a fresh clone:

```sh
npm ci
cp cloud/wrangler.example.jsonc cloud/wrangler.jsonc
npx wrangler login
npx wrangler d1 create moonlit-storybook-db
npx wrangler r2 bucket create moonlit-storybook-art
```

Copy the database ID returned by the last command into `d1_databases[0].database_id` in `cloud/wrangler.jsonc`. Choose unique Worker, database and Workflow names if those resources already exist in your account. Add `account_id` if you use multiple accounts.

将创建数据库后返回的 ID 填入配置。若账户已有同名资源，请修改 Worker、数据库与 Workflow 名称；多账户时可添加 `account_id`。

The template deploys to a `workers.dev` URL. To use a custom domain you own, add a `routes` entry with `pattern` set to that hostname and `custom_domain: true`.

模板默认使用 `workers.dev` 地址；自己的域名可通过自定义域名 route 绑定。

## Build and publish / 构建与发布

```sh
npm run check
npm run build
npx wrangler d1 migrations apply moonlit-storybook-db --remote --config cloud/wrangler.jsonc
npm run deploy
npx wrangler secret put OPENROUTER_API_KEY --config cloud/wrangler.jsonc
```

Enter your key at Wrangler's secret prompt. Until the secret is configured, generation is unavailable. For an already configured local environment, `python3 scripts/set-cloud-secret.py` sends its existing key to Wrangler through stdin, without printing or writing it into project files.

在 Wrangler 提示中输入 Key。也可使用已有本机凭据助手配置 secret；Key 不会被打印或写入项目文件。

If you renamed the database, use its new name in the migration command. Workflows are provisioned with the Worker deployment. `npm run build` is a dry run, not a publication.

## Runtime / 运行方式

- Static assets contain only `public/`. Worker source, local records, receipts and credentials are not publicly served.
- Parent knowledge settings trigger three sequential complete books with six generated illustrations each. The child shelf changes only after all eighteen illustrations are generated, downloaded and decoded. Document-local blob URLs reuse the prepared images on cover selection and page changes; private source URLs remain in the story records for owned generation references.
- Seedream 5.0 Flash is called through OpenRouter's image API at 2K, 16:9. Each prompt includes the exact page text and visual description, fixed hero appearance and book context. Later pages reference the first illustration. A continuation references the first and most recent available illustration and paints the new action.
- Private R2 objects are served through an owner-checked same-origin API. Provider keys and base64 receipts are never sent to the browser. Existing text-only books can be illustrated from the parent's library; opening a reader does not start generation. The library attaches current illustration state, and incomplete legacy shelves cannot bypass readiness checks.
- D1 records belong to an anonymous session. Every job/library query includes its owner; a known job ID does not grant access.
- A durable Workflow executes each paid generation once with a persisted claim and zero provider retries. Saving a returned result is a separate retriable step. Refreshing polls the existing job.
- Image generation also uses per-page persisted claims and zero retries, with at most three concurrent image steps per book. A failed illustration preserves the saved text but keeps the incomplete book off the child shelf; the parent library labels it as incomplete. Completed illustrations are reused.
- POST requires the same Origin. Request sizes, supported scenes/characters/props, schemas, interaction placement and hero continuity are checked.
- No daily generation cap is enforced globally, per anonymous session or per hashed IP. Daily usage units are still recorded in UTC+8 for observability: a book uses 10 units, a continuation 3 and transcription 2. These counters do not restrict generation or cap provider spending.
- Up to two pending jobs per session and six accepted jobs per minute per IP. These short-term checks and usage recording use the same D1 insertion transaction.
- A daily cron removes records and private illustrations over 30 days old. Audio is processed in memory and not persisted.
- `noindex, nofollow` keeps the demo unlisted in search intent; the URL itself is public, not a password.

公开版按匿名会话隔离故事库；生成任务可在刷新后继续等待同一任务。整站、每个会话和每个 IP 均无每日生成上限，保留短时频率与并发限制。已保存故事可随时阅读，失败不会用未完成的一组替换首页。故事与输入由每日任务清理，录音不存储。

## Verify and update / 验证与更新

After setting the key, use the HTTPS URL printed by Wrangler:

```sh
STORYBOOK_URL=https://your-worker.example python3 scripts/verify-public.py
```

This checks anonymous access, credential configuration, fresh-session isolation, private paths, Origin rejection and invalid inputs without requesting generation. The report is written to the ignored `verification/` directory.

For updates, run the checks/build, apply any new migrations, then `npm run deploy`. Keep your existing local configuration. The David Widgets directory is an independent project; deploying this repository does not add a directory entry.

Official references: [Workflows](https://developers.cloudflare.com/workflows/), [Static Assets binding](https://developers.cloudflare.com/workers/static-assets/binding/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

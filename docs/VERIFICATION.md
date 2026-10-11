# Verification / 验证记录

Observed on the live prototype on 2026-10-11. These are prototype integration checks, not a child learning study.

以下为原型集成验证，不是儿童学习效果研究。

- A parent entered opportunity cost, cooperation and probability as three knowledge points. Saving began full-book preparation before any child chose a cover.
- Three books completed with six pages each. Their stored core concepts matched the parent inputs in order. The home shelf displayed their generated covers and actual titles together.
- Clicking a cover immediately opened Scene 1 with six page controls and no generation wait. Cloud job count did not increase.
- Refreshing during preparation resumed the same job. After a quota interruption, explicit continuation reused two completed books and prepared only the missing third; the old shelf stayed readable until the new group finished.
- Earlier continuation checks submitted a custom idea and rendered a new scene with the same hero and changed location/prop. The branch was saved locally.
- The public transcription API correctly transcribed a synthetic adult system-voice fixture. Physical microphone permissions, real children's speech and system narration playback were not verified.
- Desktop and 390×844 mobile viewport checks showed no horizontal overflow. Inputs, story cards and the parent dialog stayed inside the viewport. Viewport simulation is not a real-device performance test.
- Anonymous HTTPS access, protected session cookies, empty libraries for fresh visitors, rejection of known job IDs from a different visitor, private-path 404s, cross-origin rejection and invalid-input rejection were checked.
- JavaScript syntax and the Wrangler build dry run passed. No application errors appeared in the observed browser console.

以上为初版 SVG 模板阶段的验证。逐幕 AI 插画的后续验证见下；仍未生成视频或验证儿童学习效果。

Raw runtime records, provider receipts and browser session data remain local and are excluded from the public repository. The README preview is a curated screenshot of generated demo covers.

## AI illustration upgrade / 逐幕插画升级

Verified on production on 2026-10-11:

- One newly prepared book completed six distinct 2048×1152 illustrations. Prompts use the actual page text and visual description; the five later pages used its first illustration as a reference.
- An existing six-page book acquired six illustrations without regenerating its story text. Its first page and a later boat scene were checked in the browser.
- A real continuation moved the bear into a boat with a lantern on a lake. It generated a new illustration using an owned prior image reference, retaining the bear's scarf and outfit.
- Known image URLs returned 404 in a different anonymous session. Foreign-session book upgrades and image references were rejected before generation.
- Repeating an accepted request returned the same job. Credential-free tests covered completed-image reuse, interrupted-call recovery, no automatic paid retry, image MIME/signature validation and removal of UI image metadata from story history.
- Desktop and 390×844 browser views displayed complete page illustrations and usable reading controls. SVG atmosphere remained active; template actors were hidden on illustrated pages. This is viewport simulation, not physical-device testing.
- A small lettering artifact in one old-book illustration was found during visual review and corrected with one explicit image edit. Prompts now also prohibit lettering after the story data. Representative visual checks do not guarantee every future illustration will match every detail.
- Images are private R2 objects. D1 deletion cascades were checked locally; production migration retained the removal of all daily generation caps.

New books wait for their illustration steps before completing. Failed images preserve their story text. The stricter child-shelf readiness checks below now exclude incomplete illustrated books. AI character movement and video generation are not implemented.

## Prepared artwork and visible motion / 提前绘图与可见动效

Verified on production on 2026-10-11 after correcting legacy cover selection and illustration overlays:

- A real submission through the parent form prepared three books with six completed illustrations each. D1 confirmed all eighteen images belonged to the same preparation batch and had completed before the covers appeared.
- The home shelf remained empty during the first and second book's illustration steps. After all three books finished, all three covers appeared with decoded 2048-pixel-wide images and no active preparation indicator.
- Opening a cover and changing pages immediately used document-local prepared image URLs. The reader entry has no generation call. Production job counts remained at 35 books and four turns through opening, page changes and refresh.
- Computed camera and SVG ripple transforms changed between observed frames. Floating light opacity also changed. Disabling gentle motion removed the camera animation and hid the SVG overlay; enabling it restored the effects.
- The SVG overlay is inside the illustration frame and shares the painting's aspect ratio. A 390×844 viewport showed no horizontal overflow, matching artwork/overlay widths and a loaded illustration. The viewport override and original motion preference were restored afterward.
- Refreshing loaded the same three completed books and prepared their images before rendering covers. The observed browser console had no application errors.
- Credential-free regression checks cover incomplete legacy shelves, failed-image exclusion, waiting for all image downloads/decodes, reuse on reopening, image-delivery recovery without generation, and scene-specific SVG overlays.

现在由家长提前准备故事与全部插画，载入后再展示封面。未补齐插画的旧故事保留在家长故事库，可由家长明确启动补图；孩子点开不会触发生成。动态效果是插画上的 SVG 氛围叠层与缓慢镜头变化，尚不包含角色肢体动画。

## Public repository checks / 公开仓库整理验证

- A clean copy of the tracked files passed `npm ci`, JavaScript syntax checks and the Wrangler dry run using only the example configuration.
- The bundled Python client and local server were checked without the installed credential helper or a real key: the UI loaded, the library was empty and generation returned configuration-required status. A mocked provider error verified that the portable client does not retry; no additional paid call was made for publication.
- Tracked files were checked against available credential values and common token/private-key signatures. Runtime records, private configuration, local paths, source maps and dependency/build directories were excluded.


## Finite story trees, whole-book export and movable subtitles — 2026-10-11

- A real parent-form submission prepared three books with ten completed 2K illustrations each, including every branch. All thirty images completed before the new cover set appeared. Refreshing during preparation resumed its current job.
- Every generated tree has a six-scene trunk, two two-scene branches and three terminal endings. Validation rejects cycles, broken links, duplicate or unreachable nodes and routes longer than six scenes. All three live books passed.
- The first book's main route and both branches were read through in the live UI. Each reached its own ending; the end button opened that route's discovery. Returning to a fork allowed a different prepared path. Free-form reader input is removed, and `kind: turn` returns HTTP 410 before creating a job or calling a provider.
- Reading and export were checked against the same anonymous session's D1 counts, rather than global visitor totals. No new story or continuation was created by those actions.
- The actual one-click download produced a 10.35 MB standalone HTML book containing all ten embedded raster images, the full tree, endings, bilingual subtitles and SVG effects. It contains no API routes, external script dependencies or provider metadata, and its CSP disables network connections. Its script syntax was checked; an isolated DOM harness exercised both branches, endings and restart without network access. Direct `file://` navigation is blocked by the browser testing tool, so opening the downloaded file directly in a consumer browser remains device QA.
- The subtitle background is approximately 33–36% opaque. Desktop mouse dragging, keyboard movement, reset and viewport bounds were checked. Image prompts reserve the bottom quarter as quiet scenery and use only the current route's ancestors. Physical touch was not tested.
- A 390×844 viewport had no horizontal overflow. The subtitle panel stayed within the viewport, its handle moved it by 20 pixels via an arrow key, and reset restored its position. The canvas uses clipping to prevent focus from scrolling the title bar out of view.
- Camera and SVG water-ripple transforms were observed changing on an AI illustration. The SVG atmosphere remains aligned with the illustration frame.
- Production privacy checks passed: private source paths remain unavailable, cross-origin writes are rejected and an illustration request from another session returned 404. Keys remain server-side. The image-index migration preserved older six-page illustrations while allowing the four additional nodes.

The provider rejected the original nested output schema with HTTP 400. Separating pages, forks and endings resolved this in real calls. The final request uses separate page, fork and ending arrays; the server compiles their fixed topology and validates the result. Cloud and local Python generation share this schema and prompts, and their compiled outputs were compared. Provider calls still have no automatic retries. No daily generation cap was introduced.

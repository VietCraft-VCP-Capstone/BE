# Gợi ý thêm ý tưởng mùa vụ — kế hoạch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nút "Gợi ý thêm 3 ý tưởng" nối ý tưởng mới vào danh sách ý tưởng AI của dịp, mỗi ý tưởng dựa vào một tín hiệu chưa dùng.

**Architecture:** Tách phần thuần (kho tín hiệu, chọn tín hiệu kế tiếp, dựng prompt, đọc kết quả LLM) ra `seasonal-ideas.ts` để test được.
Mục `generated_ideas.<dịp_năm>` trong Shop lưu thêm `used_anchors` + `inputs`; endpoint mới đọc mục này, gọi LLM, nối kết quả bằng một lệnh cập nhật có điều kiện trần.

**Tech Stack:** Express + Mongoose (backend, test `node --test`), React + TS (frontend).

**Spec:** `backend/docs/superpowers/specs/2026-11-28-seasonal-more-ideas-design.md`

## Global Constraints
- Mỗi đợt `IDEAS_PER_BATCH = 3`; tối đa `MAX_IDEAS_PER_CAMPAIGN = 30` ý tưởng mỗi dịp.
- Ý tưởng cũ giữ nguyên ID và nội dung; chỉ nối thêm.
- Không có biên lãi / giá vốn trên ý tưởng AI (đã bỏ trước đó).
- Mọi số trong câu chữ LLM phải qua `isGrounded`.

## Review Focus
- Mục ý tưởng kiểu cũ (không có `used_anchors`/`inputs`): nút vẫn chạy; coi 3 tín hiệu đầu là đã dùng.
- LLM trả tên trùng ý tưởng đã có (khác hoa/thường, khoảng trắng): bỏ ý tưởng đó.
- Bấm hai lần liền: lần sau nhận `busy`, không nối trùng.
- Shop mẫu (demo): từ chối như các endpoint lưu khác.
- Kho tín hiệu còn < 3: tạo đúng số tín hiệu còn lại; hết thì `no_more_signals`.

---

### Task 1: Phần thuần `seasonal-ideas.ts`

**Files:**
- Create: `backend/src/modules/analytics/application/seasonal-ideas.ts`
- Test: `backend/tests/seasonal-ideas.test.ts`

**Interfaces — Produces:**
- `interface ShopSeasonalIdea` (chuyển từ service; service re-export).
- `interface IdeaInputs` = các trường dựng prompt hiện có trong `fetchGeminiSeasonalIdeas` (shopName, catName, campId, campName, eventYear, shopStyleKeywords, shopSampleTitles, priceBand, topOppKeywords, ordersGrowth?, spendingGrowth?, comboInd?, occasionIndustryClusters?, occasionIndustryPriceBand?, industryScale?).
- `interface IdeaAnchor { key: string; text: string }` — key ổn định: `cluster:<tên thường>` / `kw:<tag thường>`.
- `anchorPool(inputs): IdeaAnchor[]` — mọi nhóm bán chạy có tên, rồi mọi từ khóa; bỏ trùng theo key.
- `usedAnchorsOf(entry, pool): string[]` — `entry.used_anchors` hoặc (kiểu cũ) key 3 tín hiệu đầu.
- `nextAnchors(pool, used, n = IDEAS_PER_BATCH): IdeaAnchor[]`.
- `ideasPrompt(inputs, anchors, existingTitles: string[]): string` — prompt hiện tại; số ý tưởng = `max(anchors.length, 1)` khi đợt đầu không có tín hiệu thì 3; thêm khối "ĐÃ CÓ" khi `existingTitles` khác rỗng.
- `draftBasisOf(inputs)`.
- `parseLlmIdeas(parsed, inputs, existingTitles): ShopSeasonalIdea[]` — map như hiện tại, lọc `isGrounded`, bỏ trùng tên (chuẩn hóa thường + gộp khoảng trắng) với `existingTitles` và trong đợt.

- [ ] Test: pool bỏ trùng & thứ tự; `nextAnchors` bỏ key đã dùng, trả < 3 khi gần hết, `[]` khi hết; `usedAnchorsOf` kiểu cũ = 3 key đầu; prompt chứa tên đã có và đúng số ý tưởng; `parseLlmIdeas` bỏ tên trùng "  Áo LEN noel " với "Áo len Noel" và bỏ ý tưởng có số không có trong dữ liệu.
- [ ] Chạy `npx tsx --test tests/seasonal-ideas.test.ts` → FAIL (module chưa có).
- [ ] Viết module; service dùng `anchorPool/nextAnchors/ideasPrompt/parseLlmIdeas` cho đợt đầu; lưu `used_anchors` và `inputs`, `inputs_at` khi lưu ý tưởng.
- [ ] `npx tsc --noEmit -p .` sạch; `npm test` pass.

### Task 2: Sinh thêm ý tưởng + endpoint

**Files:**
- Modify: `seasonal-analytics.service.ts` (thêm `generateMoreIdeas`, bổ sung `inputs` cho mục cũ trong `enrichSeasonalData`)
- Modify: `presentation/seller-analytics.router.ts` (POST `/forecast/seasonal/more-ideas`, giới hạn tần suất 6/phút)

**Interfaces:**
- `SeasonalAnalyticsService.generateMoreIdeas(shopOid, ref: { event_key; event_year }): Promise<{ ideas: ShopSeasonalIdea[] } | { error: 'no_ideas_yet' | 'no_more_signals' | 'limit_reached' | 'busy' | 'llm_unavailable' }>`
- Ghi: `$push ideas {$each}`, `$addToSet used_anchors {$each}` với điều kiện `ideas.<30 - số mới> $exists: false`.
- Router: 200 `{ success: true, ideas }`; lỗi → 409 (`busy`, `limit_reached`, `no_more_signals`, `no_ideas_yet`) / 503 (`llm_unavailable`).
- `enrichSeasonalData`: khi mục đã lưu thiếu `inputs` hoặc `inputs_at` cũ hơn 24h → `$set` `inputs`, `inputs_at`.

- [ ] Kiểm tra bằng `npm test` + `tsc`.

### Task 3: Frontend

**Files:**
- Modify: `frontend/src/modules/analytics/services/analyticsApi.ts` — `moreSeasonalIdeas(plan): Promise<{ success: boolean; ideas: AiShopIdea[] }>`
- Modify: `SeasonalPotentialTab.tsx` — state `ideaList` (đồng bộ với prop), nút dưới lưới khi `aiIdeasStatus === 'ready'` và có `planRef`; trạng thái đang soạn; lỗi `no_more_signals`/`limit_reached` tắt nút kèm "Đã dùng hết dữ liệu dịp này để gợi ý"; lỗi khác báo và cho bấm lại; số trên tab dùng `ideaList.length`.

- [ ] `npx tsc --noEmit -p .` sạch.

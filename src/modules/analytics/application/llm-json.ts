import { AiGatewayService } from './ai-gateway.service';

// BE không giữ khoá LLM: mọi lệnh gọi đi qua AI service (OpenAI là chính, hết hạn mức thì Gemini).
// Khoá OPENAI_API_KEY / GEMINI_API_KEY chỉ nằm trong AI-Analysic/app/.env.
const INTERNAL_SHOP_ID = 'system';

/** Bỏ rào ```json ... ``` nếu model bọc JSON trong markdown. */
function stripFence(text: string): string {
    return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

/** Văn bản JSON do LLM trả về, hoặc null nếu AI service không có khoá / mọi nhà cung cấp đều lỗi / quá hạn. */
export async function llmJsonText(prompt: string, timeoutMs: number): Promise<string | null> {
    const res = await AiGatewayService.call({
        method: 'POST',
        path: '/api/internal/llm/text',
        shopId: INTERNAL_SHOP_ID,
        body: { prompt, timeout_s: Math.max(1, Math.min(30, Math.round(timeoutMs / 1000))) },
        // chừa thời gian cho lượt chuyển sang Gemini ở AI service
        timeoutMs: timeoutMs * 2 + 2000,
    });
    const text = res.status === 200 ? res.body?.data?.text : null;
    return typeof text === 'string' && text.trim() ? stripFence(text) : null;
}

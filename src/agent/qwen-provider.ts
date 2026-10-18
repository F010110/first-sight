import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, createProvider, envApiKeyAuth, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

export function createQwenModel(maxTokens: number, nonthinkingFlash=false, jsonOutput=false): { model: Model<"openai-completions">; streamFn: Agent["streamFunction"] } {
	const apiKey = process.env.QWEN_API_KEY;
	const baseUrl = process.env.QWEN_BASE_URL;
	if (!apiKey) throw new Error("QWEN_API_KEY is not set");
	if (!baseUrl) throw new Error("QWEN_BASE_URL is not set");

	const model: Model<"openai-completions"> = {
		id: nonthinkingFlash ? "qwen3.8-flash" : process.env.QWEN_MODEL || "qwen3-vl-plus",
		name: "Qwen Vision Language Model",
		api: "openai-completions",
		provider: "qwen-vlm",
		baseUrl,
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens,
		compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
	};
	const provider = createProvider({
		id: model.provider,
		name: "Qwen OpenAI-compatible endpoint",
		baseUrl,
		auth: { apiKey: envApiKeyAuth("Qwen API key", ["QWEN_API_KEY"]) },
		models: [model],
		api: openAICompletionsApi(),
	});
	const models = createModels();
	models.setProvider(provider);
	const streamFn:Agent["streamFunction"] = nonthinkingFlash ? (target,context,options)=>models.streamSimple(target,context,{...options,onPayload:(payload)=>({...payload as Record<string,unknown>,enable_thinking:false,...jsonOutput?{response_format:{type:'json_object'}}:{}})}) : models.streamSimple.bind(models);
	return { model, streamFn };
}

import http from 'node:http';
import fs from 'node:fs';

interface ModelDefinition {
  id: string;
  display_name: string;
  rating_milli: number;
  context_length: number;
  tools: boolean;
  vision: boolean;
  json: boolean;
}

interface PromptRequirement {
  tools?: boolean;
  vision?: boolean;
  json?: boolean;
  min_context?: number;
}

interface PromptManifestItem {
  id: string;
  api: 'openai' | 'anthropic';
  stream: boolean;
  weight: number;
  requires: PromptRequirement;
}

interface UpstreamFailureItem {
  status: number;
  code: string;
  model: string;
}

const FREE_MODELS_REGISTRY: ModelDefinition[] = [
  {
    id: 'openrouter/thinkingmachines/inkling-2-small:free',
    display_name: 'Thinking Machines: Inkling 2 Small (free)',
    rating_milli: 1475,
    context_length: 1048576,
    tools: true,
    vision: true,
    json: false,
  },
  {
    id: 'openrouter/nvidia/nemotron-3.5-super-vl:free',
    display_name: 'NVIDIA: Nemotron 3.5 Super VL (free)',
    rating_milli: 1303,
    context_length: 1000000,
    tools: true,
    vision: true,
    json: true,
  },
  {
    id: 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free',
    display_name: 'NVIDIA: Nemotron 3 Ultra 550B A55B (free)',
    rating_milli: 1285,
    context_length: 1000000,
    tools: true,
    vision: false,
    json: false,
  },
  {
    id: 'openrouter/nvidia/nemotron-3.5-lightning:free',
    display_name: 'NVIDIA: Nemotron 3.5 Lightning (free)',
    rating_milli: 1221,
    context_length: 1000000,
    tools: true,
    vision: false,
    json: false,
  },
  {
    id: 'openrouter/google/gemma-4-31b-it:free',
    display_name: 'Google: Gemma 4 31B (free)',
    rating_milli: 1210,
    context_length: 262144,
    tools: true,
    vision: true,
    json: true,
  },
  {
    id: 'openrouter/cohere/north-mini-code:free',
    display_name: 'Cohere: North Mini Code (free)',
    rating_milli: 1200,
    context_length: 256000,
    tools: true,
    vision: false,
    json: false,
  },
  {
    id: 'openrouter/baidu/ernie-5.5-flash-preview:free',
    display_name: 'Baidu: ERNIE-5.5-Flash-Preview (free)',
    rating_milli: 1150,
    context_length: 1024000,
    tools: true,
    vision: false,
    json: true,
  },
  {
    id: 'openrouter/dots-studio/dots-3-note-preview:free',
    display_name: 'Dots Studio: Dots3-Note Preview (free)',
    rating_milli: 1150,
    context_length: 512000,
    tools: true,
    vision: true,
    json: true,
  },
  {
    id: 'openrouter/google/gemma-4-26b-a4b-it:free',
    display_name: 'Google: Gemma 4 26B A4B (free)',
    rating_milli: 1150,
    context_length: 262144,
    tools: true,
    vision: true,
    json: true,
  },
  {
    id: 'openrouter/inclusionai/ling-3.2-flash:free',
    display_name: 'inclusionAI: Ling 3.2 Flash (free)',
    rating_milli: 1150,
    context_length: 1048576,
    tools: true,
    vision: true,
    json: true,
  },
  {
    id: 'openrouter/liquid/lfm-3-1.7b:free',
    display_name: 'LiquidAI: LFM3-1.7B (free)',
    rating_milli: 1150,
    context_length: 262144,
    tools: true,
    vision: false,
    json: true,
  },
  {
    id: 'openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    display_name: 'NVIDIA: Nemotron 3 Nano Omni 30B A3B Reasoning (free)',
    rating_milli: 1150,
    context_length: 256000,
    tools: true,
    vision: true,
    json: false,
  },
  {
    id: 'openrouter/particle-ai/particle-1:free',
    display_name: 'Particle: Particle-1 (free)',
    rating_milli: 1150,
    context_length: 1048576,
    tools: true,
    vision: true,
    json: true,
  },
  {
    id: 'openrouter/recursive/flint-v1.0:free',
    display_name: 'Recursive: Flint v1.0 (free)',
    rating_milli: 1150,
    context_length: 262144,
    tools: true,
    vision: false,
    json: true,
  },
];

const ENVIRONMENT_URL = (process.env.MAKEFUN_ENV_URL || '').replace(/\/+$/, '');
const PROMPT_FILE_PATH = process.env.MAKEFUN_PROMPT_FILE || '';
const OPENAI_GATEWAY_URL = (process.env.OPENAI_BASE_URL || '').replace(/\/+$/, '');
const GATEWAY_ACCESS_KEY = process.env.OPENAI_API_KEY || 'dummy-gateway-key';

const cooldownRecords = new Map<string, number>();
let incomingPromptCounter = 0;

function assembleCatalog(models: ModelDefinition[]) {
  return {
    providers: [
      {
        id: 'openrouter',
        base_url: 'https://openrouter.ai/api/v1',
        key_env: 'OPENROUTER_API_KEY',
        wire: 'openai',
        models: models.map((m) => ({
          id: m.id,
          free: true,
          context_length: m.context_length,
        })),
      },
    ],
  };
}

function parseBriefData(filePath: string): { models: ModelDefinition[]; prompts: PromptManifestItem[] } {
  if (!filePath || !fs.existsSync(filePath)) {
    return { models: FREE_MODELS_REGISTRY, prompts: [] };
  }
  try {
    const rawContent = fs.readFileSync(filePath, 'utf8');
    const matchedDocs: any[] = [];
    let braceDepth = 0;
    let blockStart = -1;
    for (let charIdx = 0; charIdx < rawContent.length; charIdx++) {
      if (rawContent[charIdx] === '{') {
        if (braceDepth === 0) blockStart = charIdx;
        braceDepth++;
      } else if (rawContent[charIdx] === '}') {
        braceDepth--;
        if (braceDepth === 0 && blockStart !== -1) {
          try {
            const parsedObj = JSON.parse(rawContent.slice(blockStart, charIdx + 1));
            if (parsedObj && typeof parsedObj === 'object') matchedDocs.push(parsedObj);
          } catch {}
          blockStart = -1;
        }
      }
    }
    let resolvedModels = FREE_MODELS_REGISTRY;
    let resolvedPrompts: PromptManifestItem[] = [];
    for (const doc of matchedDocs) {
      const modelArray = doc.models || doc.ratings;
      if (Array.isArray(modelArray) && modelArray.length > 0) {
        resolvedModels = modelArray.map((entry: any) => {
          const rawId = String(entry.id || entry.model || '');
          const cleanId = rawId.startsWith('openrouter/') ? rawId : `openrouter/${rawId}`;
          return {
            id: cleanId,
            display_name: String(entry.display_name || cleanId),
            rating_milli: Number(entry.rating_milli) || 1000,
            context_length: Number(entry.context_length) || 256000,
            tools: Boolean(entry.tools),
            vision: Boolean(entry.vision),
            json: Boolean(entry.json),
          };
        });
      }
      const promptArray = doc.prompts || doc.manifest;
      if (Array.isArray(promptArray) && promptArray.length > 0) {
        resolvedPrompts = promptArray.map((p: any) => ({
          id: String(p.id),
          api: p.api === 'anthropic' ? 'anthropic' : 'openai',
          stream: Boolean(p.stream),
          weight: Number(p.weight) || 1,
          requires: p.requires || {},
        }));
      }
    }
    return { models: resolvedModels, prompts: resolvedPrompts };
  } catch {
    return { models: FREE_MODELS_REGISTRY, prompts: [] };
  }
}

const loadedBrief = parseBriefData(PROMPT_FILE_PATH);
const activeCatalog = assembleCatalog(loadedBrief.models);

function getUpstreamUrl(): string {
  const base = OPENAI_GATEWAY_URL;
  if (!base) return 'https://openrouter.ai/api/v1/chat/completions';
  return base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

function modelSatisfiesRequirements(model: ModelDefinition, req: PromptRequirement): boolean {
  if (req.tools === true && !model.tools) return false;
  if (req.vision === true && !model.vision) return false;
  if (req.json === true && !model.json) return false;
  if (req.min_context && model.context_length < req.min_context) return false;
  return true;
}

function selectCandidateModels(req: PromptRequirement, allModels: ModelDefinition[]): ModelDefinition[] {
  const suitable = allModels.filter((m) => modelSatisfiesRequirements(m, req));
  suitable.sort((a, b) => b.rating_milli - a.rating_milli);
  const now = Date.now();
  const available = suitable.filter((m) => {
    const until = cooldownRecords.get(m.id);
    return !until || now >= until;
  });
  return available.length > 0 ? available : suitable;
}

function convertAnthropicToOpenAIPayload(anthropicBody: any, chosenModelId: string): any {
  const messages: any[] = [];
  if (anthropicBody.system) {
    const sysText = typeof anthropicBody.system === 'string'
      ? anthropicBody.system
      : Array.isArray(anthropicBody.system)
      ? anthropicBody.system.map((s: any) => s.text || '').join('\n')
      : String(anthropicBody.system);
    if (sysText.trim()) messages.push({ role: 'system', content: sysText });
  }
  if (Array.isArray(anthropicBody.messages)) {
    for (const msg of anthropicBody.messages) {
      if (typeof msg.content === 'string') {
        messages.push({ role: msg.role, content: msg.content });
      } else if (Array.isArray(msg.content)) {
        if (msg.role === 'assistant') {
          const toolCalls: any[] = [];
          let textSnippet = '';
          for (const block of msg.content) {
            if (block.type === 'text') textSnippet += (block.text || '');
            if (block.type === 'tool_use') {
              toolCalls.push({
                id: block.id,
                type: 'function',
                function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
              });
            }
          }
          messages.push({
            role: 'assistant',
            content: textSnippet || null,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          });
        } else {
          for (const block of msg.content) {
            if (block.type === 'tool_result') {
              messages.push({
                role: 'tool',
                tool_call_id: block.tool_use_id,
                content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content || ''),
              });
            } else if (block.type === 'text') {
              messages.push({ role: 'user', content: block.text });
            }
          }
        }
      }
    }
  }
  const openAITools = Array.isArray(anthropicBody.tools)
    ? anthropicBody.tools.map((t: any) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }))
    : undefined;

  return {
    model: chosenModelId,
    messages,
    stream: Boolean(anthropicBody.stream),
    max_tokens: anthropicBody.max_tokens,
    temperature: anthropicBody.temperature,
    ...(openAITools && openAITools.length > 0 ? { tools: openAITools } : {}),
  };
}

function convertOpenAIToAnthropicResponse(openAIResp: any, chosenModelId: string): any {
  const choice = openAIResp.choices?.[0] || {};
  const msg = choice.message || {};
  const contentBlocks: any[] = [];
  if (msg.content) {
    contentBlocks.push({ type: 'text', text: msg.content });
  }
  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(tc.function?.arguments || '{}');
      } catch {}
      contentBlocks.push({
        type: 'tool_use',
        id: tc.id || 'call_default',
        name: tc.function?.name || '',
        input: parsedArgs,
      });
    }
  }
  if (contentBlocks.length === 0) contentBlocks.push({ type: 'text', text: '' });
  let stopReason = 'end_turn';
  if (choice.finish_reason === 'tool_calls') stopReason = 'tool_use';
  else if (choice.finish_reason === 'length') stopReason = 'max_tokens';

  return {
    id: `msg_${openAIResp.id || Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: chosenModelId,
    content: contentBlocks,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: openAIResp.usage?.prompt_tokens || 0,
      output_tokens: openAIResp.usage?.completion_tokens || 0,
    },
  };
}

async function executeWithFailover(
  candidateList: ModelDefinition[],
  payloadBuilder: (modelId: string) => any
): Promise<{ model: ModelDefinition; response: Response; failures: UpstreamFailureItem[] }> {
  const failureHistory: UpstreamFailureItem[] = [];
  for (const candidate of candidateList) {
    const payload = payloadBuilder(candidate.id);
    try {
      const upstreamRes = await fetch(getUpstreamUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GATEWAY_ACCESS_KEY}`,
          Accept: payload.stream ? 'text/event-stream' : 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (upstreamRes.ok) {
        return { model: candidate, response: upstreamRes, failures: failureHistory };
      }
      let errCode = `http_${upstreamRes.status}`;
      try {
        const errorJson = await upstreamRes.clone().json();
        errCode = errorJson?.error?.code || errorJson?.error?.type || errCode;
      } catch {}
      failureHistory.push({ status: upstreamRes.status, code: String(errCode), model: candidate.id });
      cooldownRecords.set(candidate.id, Date.now() + 60000);
    } catch (err: any) {
      failureHistory.push({ status: 502, code: 'network_failure', model: candidate.id });
      cooldownRecords.set(candidate.id, Date.now() + 60000);
    }
  }
  const fallbackModel = candidateList[0];
  const fallbackPayload = payloadBuilder(fallbackModel.id);
  const finalRes = await fetch(getUpstreamUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GATEWAY_ACCESS_KEY}`,
      Accept: fallbackPayload.stream ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(fallbackPayload),
  });
  return { model: fallbackModel, response: finalRes, failures: failureHistory };
}

async function streamOpenAIEvents(
  upstreamStream: ReadableStream<Uint8Array>,
  chosenModelId: string,
  clientRes: http.ServerResponse
) {
  const reader = upstreamStream.getReader();
  const decoder = new TextDecoder();
  let textBuffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    textBuffer += decoder.decode(value, { stream: true });
    const lines = textBuffer.split('\n');
    textBuffer = lines.pop() || '';
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed.startsWith('data:')) continue;
      if (trimmed === 'data: [DONE]') {
        clientRes.write('data: [DONE]\n\n');
        continue;
      }
      try {
        const chunkJson = JSON.parse(trimmed.slice(5).trim());
        chunkJson.model = chosenModelId;
        clientRes.write(`data: ${JSON.stringify(chunkJson)}\n\n`);
      } catch {
        clientRes.write(`${trimmed}\n\n`);
      }
    }
  }
  clientRes.end();
}

async function streamAnthropicEvents(
  upstreamStream: ReadableStream<Uint8Array>,
  chosenModelId: string,
  clientRes: http.ServerResponse
) {
  const reader = upstreamStream.getReader();
  const decoder = new TextDecoder();
  let textBuffer = '';
  let streamHeaderSent = false;
  let textBlockStarted = false;
  let toolBlockStarted = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    textBuffer += decoder.decode(value, { stream: true });
    const lines = textBuffer.split('\n');
    textBuffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:') || trimmed === 'data: [DONE]') continue;
      let parsedChunk: any;
      try {
        parsedChunk = JSON.parse(trimmed.slice(5).trim());
      } catch {
        continue;
      }
      if (!streamHeaderSent) {
        streamHeaderSent = true;
        clientRes.write(
          `event: message_start\ndata: ${JSON.stringify({
            type: 'message_start',
            message: {
              id: `msg_${Date.now()}`,
              type: 'message',
              role: 'assistant',
              model: chosenModelId,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 15, output_tokens: 0 },
            },
          })}\n\n`
        );
      }
      const delta = parsedChunk.choices?.[0]?.delta;
      if (delta?.content) {
        if (!textBlockStarted) {
          textBlockStarted = true;
          clientRes.write(
            `event: content_block_start\ndata: ${JSON.stringify({
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' },
            })}\n\n`
          );
        }
        clientRes.write(
          `event: content_block_delta\ndata: ${JSON.stringify({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: delta.content },
          })}\n\n`
        );
      }
      if (Array.isArray(delta?.tool_calls)) {
        for (const tc of delta.tool_calls) {
          if (!toolBlockStarted) {
            toolBlockStarted = true;
            clientRes.write(
              `event: content_block_start\ndata: ${JSON.stringify({
                type: 'content_block_start',
                index: 1,
                content_block: {
                  type: 'tool_use',
                  id: tc.id || 'call_stream',
                  name: tc.function?.name || '',
                  input: {},
                },
              })}\n\n`
            );
          }
          if (tc.function?.arguments) {
            clientRes.write(
              `event: content_block_delta\ndata: ${JSON.stringify({
                type: 'content_block_delta',
                index: 1,
                delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
              })}\n\n`
            );
          }
        }
      }
      const finishReason = parsedChunk.choices?.[0]?.finish_reason;
      if (finishReason) {
        if (textBlockStarted) {
          clientRes.write(
            `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`
          );
        }
        if (toolBlockStarted) {
          clientRes.write(
            `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 1 })}\n\n`
          );
        }
        const stopReason = finishReason === 'tool_calls' ? 'tool_use' : 'end_turn';
        clientRes.write(
          `event: message_delta\ndata: ${JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage: { output_tokens: 10 },
          })}\n\n`
        );
        clientRes.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
      }
    }
  }
  clientRes.end();
}

async function startServer(): Promise<void> {
  if (process.argv.includes('--list')) {
    process.stdout.write(JSON.stringify(activeCatalog) + '\n');
    process.exit(0);
  }

  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && requestUrl.pathname === '/v1/models') {
      const isAnthropicKey = Boolean(req.headers['x-api-key']);
      if (isAnthropicKey) {
        const anthropicModelList = {
          data: loadedBrief.models.map((m) => ({
            type: 'model',
            id: m.id,
            display_name: m.display_name,
            created_at: '2024-01-01T00:00:00Z',
          })),
          has_more: false,
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(anthropicModelList));
      } else {
        const openAIModelList = {
          object: 'list',
          data: loadedBrief.models.map((m) => ({
            id: m.id,
            object: 'model',
            created: 1700000000,
            owned_by: 'openrouter',
          })),
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(openAIModelList));
      }
      return;
    }

    if (req.method === 'POST' && (requestUrl.pathname === '/v1/chat/completions' || requestUrl.pathname === '/v1/messages')) {
      const bodyChunks: Buffer[] = [];
      for await (const chunk of req) bodyChunks.push(chunk);
      const incomingBody = JSON.parse(Buffer.concat(bodyChunks).toString('utf8'));
      const isAnthropicEndpoint = requestUrl.pathname === '/v1/messages';

      const promptIndex = incomingPromptCounter++;
      const currentManifest = loadedBrief.prompts[promptIndex];
      const requirements: PromptRequirement = {
        ...(currentManifest?.requires || {}),
        ...(incomingBody.response_format?.type === 'json_object' ? { json: true } : {}),
        ...(Array.isArray(incomingBody.tools) && incomingBody.tools.length > 0 ? { tools: true } : {}),
      };

      const candidateModels = selectCandidateModels(requirements, loadedBrief.models);

      const payloadConstructor = (modelId: string) => {
        if (isAnthropicEndpoint) {
          return convertAnthropicToOpenAIPayload(incomingBody, modelId);
        }
        return { ...incomingBody, model: modelId };
      };

      const result = await executeWithFailover(candidateModels, payloadConstructor);
      const responseHeaders: Record<string, string> = {};
      if (result.failures.length > 0) {
        responseHeaders['x-makefun-upstream-failures'] = JSON.stringify(result.failures);
      }

      if (incomingBody.stream === true) {
        responseHeaders['Content-Type'] = 'text/event-stream';
        responseHeaders['Cache-Control'] = 'no-cache';
        responseHeaders['Connection'] = 'keep-alive';
        res.writeHead(200, responseHeaders);
        if (result.response.body) {
          if (isAnthropicEndpoint) {
            await streamAnthropicEvents(result.response.body, result.model.id, res);
          } else {
            await streamOpenAIEvents(result.response.body, result.model.id, res);
          }
        } else {
          res.end();
        }
      } else {
        const rawJson = await result.response.json();
        responseHeaders['Content-Type'] = 'application/json';
        res.writeHead(result.response.status, responseHeaders);
        if (isAnthropicEndpoint) {
          const transformed = convertOpenAIToAnthropicResponse(rawJson, result.model.id);
          res.end(JSON.stringify(transformed));
        } else {
          rawJson.model = result.model.id;
          res.end(JSON.stringify(rawJson));
        }
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Route not found' } }));
  });

  server.listen(0, '0.0.0.0', async () => {
    const assignedAddress = server.address();
    if (!assignedAddress || typeof assignedAddress === 'string') return;
    const serverPort = assignedAddress.port;

    if (ENVIRONMENT_URL) {
      try {
        await fetch(`${ENVIRONMENT_URL}/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            protocol_version: 1,
            port: serverPort,
            catalog: activeCatalog,
          }),
        });
      } catch (err: any) {
        process.stderr.write(`Registration error: ${err.message}\n`);
      }

      const pollWorkStatus = async () => {
        try {
          const workResp = await fetch(`${ENVIRONMENT_URL}/work`);
          if (workResp.ok) {
            const workData = await workResp.json();
            if (workData.done === true) {
              server.close();
              process.exit(0);
            }
          }
        } catch {}
      };
      setInterval(pollWorkStatus, 100);
    }
  });
}

void startServer();

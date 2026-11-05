import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { createInterface } from 'node:readline'

const invalid = message => { throw Object.assign(new Error(message), { statusCode: 400 }) }

function textParts(content) {
  if (content == null) return []
  if (typeof content === 'string') return [{ text: content }]
  if (!Array.isArray(content)) invalid('message content must be text or content parts')
  return content.map(part => {
    if (!part || typeof part !== 'object') invalid('each content part must be an object')
    if (part.type === 'text' && typeof part.text === 'string') return { text: part.text }
    const image = part.type === 'image_url' && /^data:([^;]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(part.image_url?.url)
    if (image) return { inlineData: { mimeType: image[1], data: image[2] } }
    return invalid('only text and base64 image content parts are supported')
  })
}

/**
 * Translate OpenAI messages and function tools without discarding tool history.
 * @param {object} body OpenAI chat-completions request.
 * @returns {object} Cloud Code Assist generation request.
 */
export function toCloudCodeRequest(body) {
  if (!Array.isArray(body.messages) || body.messages.length === 0) invalid('messages must be a nonempty array')
  if (typeof body.model !== 'string' || !body.model) invalid('model must be a nonempty string')
  if (body.n !== undefined && body.n !== 1) invalid('only n=1 is supported')
  if (body.stream !== undefined && typeof body.stream !== 'boolean') invalid('stream must be a boolean')
  if (body.tools !== undefined && !Array.isArray(body.tools)) invalid('tools must be an array')
  const calls = new Map()
  const system = []
  const contents = []
  for (const message of body.messages) {
    if (!message || typeof message !== 'object') invalid('each message must be an object')
    if (message.reasoning_details !== undefined && !Array.isArray(message.reasoning_details)) invalid('reasoning_details must be an array')
    if (message.role === 'system' || message.role === 'developer') {
      system.push(...textParts(message.content))
      continue
    }
    const parts = []
    if (message.role === 'tool') {
      const name = calls.get(message.tool_call_id)
      if (!name) invalid('tool message must reference an earlier assistant tool call')
      let result = message.content
      if (typeof result === 'string') {
        try { result = JSON.parse(result) } catch { /* Plain text tool results remain text. */ }
      }
      parts.push({ functionResponse: { name, response: { result } } })
    } else {
      if (message.role !== 'user' && message.role !== 'assistant') invalid(`unsupported message role: ${message.role}`)
      parts.push(...textParts(message.content))
      if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) invalid('tool_calls must be an array')
      for (const call of message.tool_calls ?? []) {
        if (call?.type !== 'function' || !call.id || !call.function?.name) invalid('invalid function tool call')
        let args
        try { args = JSON.parse(call.function.arguments) } catch { invalid('tool arguments must be JSON') }
        if (!args || typeof args !== 'object' || Array.isArray(args)) invalid('tool arguments must be a JSON object')
        calls.set(call.id, call.function.name)
        const signature = call.extra_content?.google?.thought_signature
          ?? message.reasoning_details?.find(detail => detail.type === 'reasoning.encrypted' && detail.id === call.id)?.data
        parts.push({ functionCall: { name: call.function.name, args },
          ...(signature ? { thoughtSignature: signature } : {}) })
      }
    }
    if (parts.length === 0) continue
    const role = message.role === 'assistant' ? 'model' : 'user'
    const previous = contents.at(-1)
    if (previous?.role === role) previous.parts.push(...parts)
    else contents.push({ role, parts })
  }
  const declarations = (body.tools ?? []).map(tool => {
    if (tool?.type !== 'function' || !tool.function?.name) invalid('only function tools are supported')
    const { name, description, parameters } = tool.function
    return { name, description, parameters }
  })
  const generationConfig = {}
  const maxTokens = body.max_completion_tokens ?? body.max_tokens ?? 8192
  if (!Number.isInteger(maxTokens) || maxTokens < 1) invalid('max_tokens must be a positive integer')
  generationConfig.maxOutputTokens = maxTokens
  for (const [source, target] of [['temperature', 'temperature'], ['top_p', 'topP']]) {
    if (body[source] !== undefined) {
      if (!Number.isFinite(body[source])) invalid(`${source} must be a number`)
      generationConfig[target] = body[source]
    }
  }
  if (body.stop !== undefined) {
    const stops = typeof body.stop === 'string' ? [body.stop] : body.stop
    if (!Array.isArray(stops) || stops.some(item => typeof item !== 'string')) invalid('stop must be text or an array of text')
    generationConfig.stopSequences = stops
  }
  if (contents.length === 0) invalid('messages must contain user, assistant or tool content')
  const request = { contents, generationConfig }
  if (system.length) request.systemInstruction = { parts: system }
  if (declarations.length) request.tools = [{ functionDeclarations: declarations }]
  if (body.tool_choice !== undefined) {
    const choice = body.tool_choice
    const mode = { auto: 'AUTO', none: 'NONE', required: 'ANY' }[choice]
    const name = choice?.type === 'function' && choice.function?.name
    if (!mode && !name) invalid('unsupported tool_choice')
    request.toolConfig = { functionCallingConfig: { mode: mode ?? 'ANY',
      ...(name ? { allowedFunctionNames: [name] } : {}) } }
    if (mode === 'NONE') delete request.tools
  }
  return request
}

async function * events(upstream) {
  if (!upstream.headers.get('content-type')?.includes('text/event-stream')) {
    yield await upstream.json()
    return
  }
  const input = Readable.fromWeb(upstream.body)
  const lines = createInterface({ input, crlfDelay: Infinity })
  let failure
  input.on('error', error => { failure = error; lines.close() })
  let data = []
  try {
    for await (const line of lines) {
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
      if (line === '' && data.length) {
        const payload = data.join('\n')
        data = []
        if (payload === '[DONE]') return
        yield JSON.parse(payload)
      }
    }
    if (failure) throw failure
    if (data.length && data.join('\n') !== '[DONE]') yield JSON.parse(data.join('\n'))
  } finally { lines.close(); input.destroy() }
}

/**
 * Relay Cloud Code SSE as OpenAI SSE, or aggregate a non-streaming response.
 * @param {Response} upstream Successful Cloud Code Assist response.
 * @param {import('node:http').ServerResponse} response Client response.
 * @param {object} body Original OpenAI request.
 * @returns {Promise<void>} Settles after the response ends; rejects malformed upstream events.
 */
export async function replyCloudCode(upstream, response, body) {
  const id = `chatcmpl-${randomUUID()}`
  const created = Math.floor(Date.now() / 1000)
  const streaming = body.stream === true
  const calls = []
  const reasoningDetails = []
  let content = ''
  let reasoning = ''
  let finishReason = 'stop'
  let usage
  let observed = false
  const chunk = (delta, finish = null) => ({ id, object: 'chat.completion.chunk', created, model: body.model,
    choices: [{ index: 0, delta, finish_reason: finish }] })
  const emit = value => response.write(`data: ${JSON.stringify(value)}\n\n`)
  if (streaming) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    response.flushHeaders()
    emit(chunk({ role: 'assistant', content: '' }))
  }
  for await (const event of events(upstream)) {
    if (event.error) throw new Error(`Cloud Code stream error: ${event.error.status ?? event.error.code ?? 'unknown'}`)
    const result = event.response ?? event
    const candidate = result.candidates?.[0]
    if (candidate || result.promptFeedback?.blockReason) observed = true
    if (result.promptFeedback?.blockReason) finishReason = 'content_filter'
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part.text === 'string') {
        if (!streaming && part.thought) reasoning += part.text
        else if (!streaming) content += part.text
        if (streaming) emit(chunk(part.thought ? { reasoning_content: part.text } : { content: part.text }))
      }
      if (part.functionCall) {
        if (body.tool_choice === 'none') throw new Error('Cloud Code returned a function call while tool_choice is none')
        const call = { id: part.functionCall.id ?? `call_${randomUUID()}`, type: 'function',
          function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) } }
        const index = calls.length
        calls.push(call)
        if (part.thoughtSignature) {
          const detail = { type: 'reasoning.encrypted', id: call.id, data: part.thoughtSignature, format: 'google-antigravity-v1' }
          reasoningDetails.push(detail)
          if (streaming) emit(chunk({ reasoning_details: [detail] }))
        }
        if (streaming) emit(chunk({ tool_calls: [{ index, ...call }] }))
      }
    }
    if (candidate?.finishReason === 'MAX_TOKENS') finishReason = 'length'
    else if (candidate?.finishReason && candidate.finishReason !== 'STOP') finishReason = 'content_filter'
    if (result.usageMetadata) {
      const meta = result.usageMetadata
      usage = { prompt_tokens: meta.promptTokenCount ?? 0,
        completion_tokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
        total_tokens: meta.totalTokenCount ?? 0 }
    }
  }
  if (!observed) throw new Error('Cloud Code response contains no candidates or block reason')
  if (calls.length) finishReason = 'tool_calls'
  if (streaming) {
    emit(chunk({}, finishReason))
    if (usage && body.stream_options?.include_usage) {
      emit({ ...chunk({}), choices: [], usage })
    }
    response.end('data: [DONE]\n\n')
  } else {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ id, object: 'chat.completion', created, model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: content || null,
        ...(reasoning ? { reasoning_content: reasoning } : {}),
        ...(calls.length ? { tool_calls: calls } : {}),
        ...(reasoningDetails.length ? { reasoning_details: reasoningDetails } : {}) }, finish_reason: finishReason }], usage }))
  }
}

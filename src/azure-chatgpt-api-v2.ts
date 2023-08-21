import Keyv from 'keyv'
import pTimeout from 'p-timeout'
import QuickLRU from 'quick-lru'
import { v4 as uuidv4 } from 'uuid'

import * as tokenizer from './tokenizer'
import * as types from './types'
import { fetch as globalFetch } from './fetch'
import { fetchSSE } from './fetch-sse'

const CHATGPT_MODEL = 'chatgpt'

const USER_LABEL_DEFAULT = 'User'
const ASSISTANT_LABEL_DEFAULT = 'ChatGPT'

export class AzureChatGPTAPIv2 {
  protected _apiKey: string
  protected _apiBaseUrl: string
  protected _debug: boolean
  protected _systemMessage: string
  protected _completionParams: Omit<
    types.openai.CreateChatCompletionRequest,
    'messages' | 'n'
  >

  protected _indexName: string
  protected _endpoint: string
  protected _key: string

  protected _maxModelTokens: number
  protected _maxResponseTokens: number
  protected _fetch: types.FetchFn

  protected _getMessageById: types.GetMessageByIdFunction
  protected _upsertMessage: types.UpsertMessageFunction

  protected _messageStore: Keyv<types.ChatMessage>

  protected _deployModel: string

  /**
   * Creates a new client wrapper around Azure OpenAI's chat completion API, mimicing the official ChatGPT webapp's functionality as closely as possible.
   *
   * @param apiKey - Azure OpenAI API key (required).
   * @param apiBaseUrl - Azure OpenAI API base URL (required).
   * @param debug - Optional enables logging debugging info to stdout.
   * @param completionParams - Param overrides to send to the [OpenAI chat completion API](https://platform.openai.com/docs/api-reference/chat/create). Options like `temperature` and `presence_penalty` can be tweaked to change the personality of the assistant.
   * @param maxModelTokens - Optional override for the maximum number of tokens allowed by the model's context. Defaults to 4096.
   * @param maxResponseTokens - Optional override for the minimum number of tokens allowed for the model's response. Defaults to 1000.
   * @param messageStore - Optional [Keyv](https://github.com/jaredwray/keyv) store to persist chat messages to. If not provided, messages will be lost when the process exits.
   * @param getMessageById - Optional function to retrieve a message by its ID. If not provided, the default implementation will be used (using an in-memory `messageStore`).
   * @param upsertMessage - Optional function to insert or update a message. If not provided, the default implementation will be used (using an in-memory `messageStore`).
   * @param fetch - Optional override for the `fetch` implementation to use. Defaults to the global `fetch` function.
   * @param deployModel - required for Azure Open AI
   */
  constructor(opts: types.ChatGPTAPIOptions, deployModel: string) {
    const {
      apiKey,
      apiBaseUrl,
      debug = false,
      messageStore,
      ACSindexName,
      ACSendpoint,
      ACSkey,
      completionParams,
      systemMessage,
      maxModelTokens = 4000,
      maxResponseTokens = 1000,
      getMessageById,
      upsertMessage,
      fetch = globalFetch
    } = opts

    this._apiKey = apiKey
    this._apiBaseUrl = apiBaseUrl
    this._debug = !!debug
    this._fetch = fetch
    this._deployModel = deployModel

    this._completionParams = {
      model: CHATGPT_MODEL,
      temperature: 0.8,
      top_p: 1.0,
      presence_penalty: 1.0,
      stop: ['<|im_end|>'],
      ...completionParams
    }

    this._systemMessage = systemMessage
    
    if (this._systemMessage === undefined) {
      this._systemMessage = `No one has set your systemMessage value. You should let them know they need to do that!`
    }

    this._indexName = ACSindexName
    
    if (this._indexName === undefined) {
      this._indexName = `openai-test`
    }

    this._endpoint = ACSendpoint
    
    if (this._endpoint === undefined) {
      this._endpoint = `https://ngteamsbot-cogsearch.search.windows.net`
    }

    this._key = ACSkey
    
    if (this._key === undefined) {
      this._key = `tkk2UncGDNWfdnK3rOJGzagD1vEk3RnNGgUVKjY9vjAzSeCK3ilk`
    }

    this._maxModelTokens = maxModelTokens
    this._maxResponseTokens = maxResponseTokens

    this._getMessageById = getMessageById ?? this._defaultGetMessageById
    this._upsertMessage = upsertMessage ?? this._defaultUpsertMessage

    if (messageStore) {
      this._messageStore = messageStore
    } else {
      this._messageStore = new Keyv<types.ChatMessage, any>({
        store: new QuickLRU<string, types.ChatMessage>({ maxSize: 10000 })
      })
    }

    if (!this._apiKey) {
      throw new Error('OpenAI missing required apiKey')
    }

    if (!this._fetch) {
      throw new Error('Invalid environment; fetch is not defined')
    }

    if (typeof this._fetch !== 'function') {
      throw new Error('Invalid "fetch" is not a function')
    }
  }

  /**
   * Creates a new client wrapper around Azure OpenAI's chat completion API, mimicing the official ChatGPT webapp's functionality as closely as possible.
   *
   * @param apiKey - Azure OpenAI API key (required).
   * @param apiBaseUrl - Azure OpenAI API base URL (required).
   * @param debug - Optional enables logging debugging info to stdout.
   * @param completionParams - Param overrides to send to the [OpenAI chat completion API](https://platform.openai.com/docs/api-reference/chat/create). Options like `temperature` and `presence_penalty` can be tweaked to change the personality of the assistant.
   * @param maxModelTokens - Optional override for the maximum number of tokens allowed by the model's context. Defaults to 4096.
   * @param maxResponseTokens - Optional override for the minimum number of tokens allowed for the model's response. Defaults to 1000.
   * @param messageStore - Optional [Keyv](https://github.com/jaredwray/keyv) store to persist chat messages to. If not provided, messages will be lost when the process exits.
   * @param getMessageById - Optional function to retrieve a message by its ID. If not provided, the default implementation will be used (using an in-memory `messageStore`).
   * @param upsertMessage - Optional function to insert or update a message. If not provided, the default implementation will be used (using an in-memory `messageStore`).
   * @param fetch - Optional override for the `fetch` implementation to use. Defaults to the global `fetch` function.
   * @param deployModel - required for Azure Open AI
   */

  async sendMessage(
    text: string,
    opts: types.SendMessageOptions = {}
  ): Promise<types.ChatMessage> {
    const {
      parentMessageId,
      messageId = uuidv4(),
      timeoutMs,
      onProgress,
      stream = onProgress ? true : false
    } = opts

    let { abortSignal } = opts

    let abortController: AbortController = null
    if (timeoutMs && !abortSignal) {
      abortController = new AbortController()
      abortSignal = abortController.signal
    }

    const message: types.ChatMessage = {
      role: 'user',
      id: messageId,
      parentMessageId,
      text
    }
    
    await this._upsertMessage(message)

    const {messages, maxTokens, numTokens} = await this._buildMessages(
      text,
      opts
    )

    const dataSources: types.dataSources[] = [
        {
            "type": "AzureCognitiveSearch",
            "parameters": {
                "endpoint": this._endpoint,
                "key": this._key,
                "indexName": this._indexName,
                "inScope": false,
                "roleInformation": this._systemMessage
            }
        }
    ]
    ;

    const result: types.ChatMessage = {
      role: 'assistant',
      id: uuidv4(),
      parentMessageId: messageId,
      text: ''
    }

    const responseP = new Promise<types.ChatMessage>(
      async (resolve, reject) => {
        const url = `${this._apiBaseUrl}openai/deployments/${this._deployModel}/extensions/chat/completions?api-version=2023-08-01-preview`

        console.log(`\r\n ${url}`)

        const headers = {
          'Content-Type': 'application/json',
          'api-key': this._apiKey
        }

        console.log(`\r\n ${this._apiKey}`)

        console.log(`\r\n ${messages[1].content}`)

        console.log(`\r\n ${messages[1].name}`)

        console.log(`\r\n ${messages[1].role}`)

        console.log(`\r\n ${stream}`)

        const body = {
          max_tokens: maxTokens,
          ...this._completionParams,
          dataSources,
          messages,
          stream
        }

        if (this._debug) {
          console.log(`sendMessage (${numTokens} tokens)`, body)
        }

        if (stream) {
          fetchSSE(
            url,
            {
              method: 'POST',
              headers,
              body: JSON.stringify(body),
              signal: abortSignal,
              onMessage: (data: string) => {
                if (data === '[DONE]') {
                  result.text = result.text.trim()
                  return resolve(result)
                }

                try {
                  const response: types.openai.CreateChatCompletionDeltaResponse =
                    JSON.parse(data)

                  if (response.id) {
                    result.id = response.id
                  }

                  if (response?.choices?.length) {
                    const delta = response.choices[0].delta
                    result.delta = delta.content
                    if (delta?.content) result.text += delta.content
                    result.detail = response

                    if (delta.role) {
                      result.role = delta.role
                    }

                    onProgress?.(result)
                  }
                } catch (err) {
                  console.warn('OpenAI stream SEE event unexpected error', err)
                  return reject(err)
                }
              }
            },
            this._fetch
          ).catch(reject)
        } else {
          try {
           // console.log(JSON.stringify(body))

           // let prompts: string = ''

           // body.messages.forEach((e) => {
           //   prompts = `${prompts}\n<|im_start|>${e.role}\n${e.content}\n<|im_end|>`
           // })

           // prompts = `${prompts}\n<|im_start|>assistant\n`

           // console.log(JSON.stringify(prompts))
            
            const azureBody = {
              max_tokens: maxTokens,
              ...this._completionParams,
              dataSources,
              messages,
              stream
            }

            console.log(JSON.stringify(azureBody))

            const res = await this._fetch(url, {
              method: 'POST',
              headers,
              body: JSON.stringify(azureBody),
              signal: abortSignal
            })

            console.log(JSON.stringify(res))

            if (!res.ok) {
              const reason = await res.text()
              const msg = `OpenAI error ${
                res.status || res.statusText
              }: ${reason}`
              const error = new types.ChatGPTError(msg, { cause: res })
              error.statusCode = res.status
              error.statusText = res.statusText
              return reject(error)
            }

            const response: any = await res.json()
            if (this._debug) {
              console.log(response)
            }

            console.log(response)

            if (response?.id) {
              result.id = response.id
            }

            if (response?.choices?.length) {
              const message = response.choices[0].text
              result.text = message
            } else {
              const res = response as any
              return reject(
                new Error(
                  `OpenAI error: ${
                    res?.detail?.message || res?.detail || 'unknown'
                  }`
                )
              )
            }

            result.detail = response

            return resolve(result)
          } catch (err) {
            return reject(err)
          }
        }
      }
    ).then((message) => {
      return this._upsertMessage(message).then(() => message)
    })

    if (timeoutMs) {
      if (abortController) {
        // This will be called when a timeout occurs in order for us to forcibly
        // ensure that the underlying HTTP request is aborted.
        ;(responseP as any).cancel = () => {
          abortController.abort()
        }
      }

      return pTimeout(responseP, {
        milliseconds: timeoutMs,
        message: 'OpenAI timed out waiting for response'
      })
    } else {
      return responseP
    }
  }

  get apiKey(): string {
    return this._apiKey
  }

  set apiKey(apiKey: string) {
    this._apiKey = apiKey
  }

  protected async _buildMessages(text: string, opts: types.SendMessageOptions) {
    const  systemMessage = this._systemMessage //} = opts
    let { parentMessageId } = opts

    const userLabel = USER_LABEL_DEFAULT
    const assistantLabel = ASSISTANT_LABEL_DEFAULT

    const maxNumTokens = this._maxModelTokens - this._maxResponseTokens
    let messages: types.openai.ChatCompletionRequestMessage[] = []


      messages.push({
        role: 'user',
        content: systemMessage
      })


    const systemMessageOffset = messages.length
    let nextMessages = text
      ? messages.concat([
          {
            role: 'user',
            content: text,
            name: opts.name
          }
        ])
      : messages
    let numTokens = 0

    do {
      const prompt = nextMessages
        .reduce((prompt, message) => {
          switch (message.role) {
            case 'system':
              return prompt.concat([`Instructions:\n${message.content}`])
            case 'user':
              return prompt.concat([`${userLabel}:\n${message.content}`])
            default:
              return prompt.concat([`${assistantLabel}:\n${message.content}`])
          }
        }, [] as string[])
        .join('\n\n')

      const nextNumTokensEstimate = await this._getTokenCount(prompt)
      const isValidPrompt = nextNumTokensEstimate <= maxNumTokens

      if (prompt && !isValidPrompt) {
        break
      }

      messages = nextMessages
      numTokens = nextNumTokensEstimate

      if (!isValidPrompt) {
        break
      }

      if (!parentMessageId) {
        break
      }

      const parentMessage = await this._getMessageById(parentMessageId)
      if (!parentMessage) {
        break
      }

      const parentMessageRole = parentMessage.role || 'user'

      nextMessages = nextMessages.slice(0, systemMessageOffset).concat([
        {
          role: parentMessageRole,
          content: parentMessage.text,
          name: parentMessage.name
        },
        ...nextMessages.slice(systemMessageOffset)
      ])

      parentMessageId = parentMessage.parentMessageId
    } while (true)

    // Use up to 4096 tokens (prompt + response), but try to leave 1000 tokens
    // for the response.
    const maxTokens = Math.max(
      1,
      Math.min(this._maxModelTokens - numTokens, this._maxResponseTokens)
    )

    return { messages, maxTokens, numTokens}
  }

  protected async _getTokenCount(text: string) {
    // TODO: use a better fix in the tokenizer
    text = text.replace(/<|im_end|>/g, '')

    return tokenizer.encode(text).length
  }

  protected async _defaultGetMessageById(
    id: string
  ): Promise<types.ChatMessage> {
    const res = await this._messageStore.get(id)
    return res
  }

  protected async _defaultUpsertMessage(
    message: types.ChatMessage
  ): Promise<void> {
    await this._messageStore.set(message.id, message)
  }
}

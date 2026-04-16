import { useEffect, useState, useRef } from 'react'
import { CreateWebWorkerMLCEngine, prebuiltAppConfig, hasModelInCache, deleteModelAllInfoInCache } from '@mlc-ai/web-llm'
import type { InitProgressReport, MLCEngineInterface } from '@mlc-ai/web-llm'
import { Bot, Send, Settings, Trash2, Download, Play, CheckCircle, Link2, Unlink, SearchCode, Star, FileText } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BrowserDebugger } from './debugger'
import './App.css'

interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content?: string
  tool_calls?: any[]
  tool_call_id?: string
  name?: string
}

const AVAILABLE_MODELS = prebuiltAppConfig.model_list
  .filter(m => m.model_id.includes('SmolLM') || m.model_id.includes('Llama-3.2') || m.model_id.includes('Hermes'))
  .map(m => m.model_id)

function App() {
  const [engine, setEngine] = useState<MLCEngineInterface | null>(null)
  const [activeModel, setActiveModel] = useState<string | null>(null)
  const [progressMsg, setProgressMsg] = useState('Select a model from Settings to begin.')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  
  const [showSettings, setShowSettings] = useState(true)
  const [selectedDropdownModel, setSelectedDropdownModel] = useState(AVAILABLE_MODELS[0] || 'SmolLM2-135M-Instruct-q0f32-MLC')
  const [isModelCached, setIsModelCached] = useState(false)
  const [isCacheActionLoading, setIsCacheActionLoading] = useState(false)
  const [defaultModel, setDefaultModel] = useState<string | null>(null)

  // Debugger State
  const [isDebuggerAttached, setIsDebuggerAttached] = useState(false)
  const [activeTabId, setActiveTabId] = useState<number | null>(null)
  const [inspectionResult, setInspectionResult] = useState<string | null>(null)

  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Debugger Lifecycle
  useEffect(() => {
    const handleDetach = (source: chrome.debugger.Debuggee) => {
      if (source.tabId === activeTabId) {
        setIsDebuggerAttached(false)
        setActiveTabId(null)
        setInspectionResult(null)
      }
    }
    BrowserDebugger.onDetach(handleDetach)
    return () => BrowserDebugger.removeOnDetach(handleDetach)
  }, [activeTabId])

  // Tab Context Switching
  useEffect(() => {
    const onTabActivated = (activeInfo: { tabId: number; windowId: number }) => {
      if (activeTabId && activeInfo.tabId !== activeTabId) {
        BrowserDebugger.detach(activeTabId).catch(console.error)
        setIsDebuggerAttached(false)
        setActiveTabId(null)
        setInspectionResult(null)
      }
    }
    
    if (chrome && chrome.tabs) {
      chrome.tabs.onActivated.addListener(onTabActivated)
    }
    return () => {
      if (chrome && chrome.tabs) {
         chrome.tabs.onActivated.removeListener(onTabActivated)
      }
    }
  }, [activeTabId])

  const handleAttachDebugger = async () => {
    try {
      const tab = await BrowserDebugger.getActiveTab()
      if (tab?.id) {
        await BrowserDebugger.attach(tab.id)
        setActiveTabId(tab.id)
        setIsDebuggerAttached(true)
      } else {
        alert("No active tab found to attach to.")
      }
    } catch (err) {
      console.error(err)
      alert("Failed to attach debugger: " + err)
    }
  }

  const handleDetachDebugger = async () => {
    if (activeTabId) {
      try {
        await BrowserDebugger.detach(activeTabId)
        setIsDebuggerAttached(false)
        setActiveTabId(null)
        setInspectionResult(null)
      } catch (err) {
        console.error(err)
      }
    }
  }

  const handleRunInspection = async () => {
    if (!activeTabId) return
    try {
      setInspectionResult("Inspecting...")
      
      const expression = `
        (() => {
          const frameworks = [];
          if (window.React || document.querySelector('[data-reactroot], [data-reactid]')) frameworks.push('React');
          if (window.__VUE__ || document.querySelector('[data-v-app]')) frameworks.push('Vue');
          if (window.angular || document.querySelector('[ng-version]')) frameworks.push('Angular');
          if (window.next) frameworks.push('Next.js');
          return frameworks.length > 0 ? frameworks.join(', ') : 'No common framework detected';
        })()
      `
      const result = await BrowserDebugger.evaluate(activeTabId, expression)
      setInspectionResult(`Detected: ${result}`)
      
      if (engine) {
          setMessages(prev => [...prev, { role: 'assistant', content: `**System Context**:\nFramework Stack detected manually: \`${result}\`` }])
      }
    } catch (err) {
      setInspectionResult("Error: " + err)
    }
  }

  const loadModel = async (modelId: string) => {
    try {
      setIsCacheActionLoading(true)
      setProgressMsg(`Initializing ${modelId}...`)
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      const mlcEngine = await CreateWebWorkerMLCEngine(
        worker,
        modelId,
        {
          initProgressCallback: (report: InitProgressReport) => {
            setProgressMsg(report.text)
          }
        }
      )
      setEngine(mlcEngine)
      setActiveModel(modelId)
      setMessages([
        { role: 'assistant', content: `System initialized. Active Model: **${modelId}**.\n\nRunning fully offline. Use tools or ask questions!` }
      ])
      await checkCacheStatus(modelId)
      setShowSettings(false)
    } catch (err) {
      console.error('Failed to initialize engine', err)
      setProgressMsg('Failed to load local model. Check console for details.')
    } finally {
      setIsCacheActionLoading(false)
    }
  }

  useEffect(() => {
    const initDefault = async () => {
      let dm = AVAILABLE_MODELS[0] || 'SmolLM2-135M-Instruct-q0f32-MLC';
      if (chrome && chrome.storage) {
        const res = await chrome.storage.local.get(['defaultModel']);
        if (res.defaultModel) {
          dm = res.defaultModel as string;
          setDefaultModel(dm);
        }
      }
      setSelectedDropdownModel(dm);
      const cached = await hasModelInCache(dm);
      setIsModelCached(cached);
      
      if (cached) {
        await loadModel(dm);
      }
    };
    initDefault();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkCacheStatus = async (modelId: string) => {
    setIsCacheActionLoading(true)
    try {
      const cached = await hasModelInCache(modelId)
      setIsModelCached(cached)
    } finally {
      setIsCacheActionLoading(false)
    }
  }

  useEffect(() => {
    checkCacheStatus(selectedDropdownModel)
  }, [selectedDropdownModel])

  const handleDeleteCache = async () => {
    setIsCacheActionLoading(true)
    setProgressMsg(`Deleting ${selectedDropdownModel} from cache...`)
    try {
      await deleteModelAllInfoInCache(selectedDropdownModel)
      await checkCacheStatus(selectedDropdownModel)
      setProgressMsg('Model deleted from cache.')
      if (activeModel === selectedDropdownModel) {
        setEngine(null)
        setActiveModel(null)
      }
    } finally {
      setIsCacheActionLoading(false)
    }
  }

  const handleSetDefault = async () => {
    if (chrome && chrome.storage) {
      await chrome.storage.local.set({ defaultModel: selectedDropdownModel })
      setDefaultModel(selectedDropdownModel)
    }
  }

  // The Orchestrator core
  const handleAgenticLoop = async (
    e?: React.FormEvent, 
    injectedHistory: Message[] = [], 
    toolResultAppend?: Message
  ) => {
    if (e) e.preventDefault()
    if (!engine) return

    const isRecursive = injectedHistory.length > 0;
    const userMessageContent = input.trim()

    if (!isRecursive && !userMessageContent) return
    
    // UI Update logic
    if (!isRecursive) {
      setInput('')
      setIsGenerating(true)
      const userMessage: Message = { role: 'user', content: userMessageContent }
      setMessages(prev => [...prev, userMessage, { role: 'assistant', content: '' }])
    } else if (toolResultAppend) {
      // Add tool result to visible context securely
      setMessages(prev => {
         const nm = [...prev];
         // Ensure last message is an assistant buffer for the upcoming generation
         nm.push({ role: 'assistant', content: '' });
         return nm;
      })
    }

    try {
      const toolSchema = [
        {
          type: "function",
          function: {
            name: "execute_browser_action",
            description: "Unified interface to inspect and interact with the active browser tab. Use this for ALL page queries.",
            parameters: {
              type: "object",
              properties: {
                action: {
                  type: "string",
                  enum: ["read_dom", "query_selector", "get_styles", "get_console_logs", "get_page_frameworks"],
                  description: "The type of browser action to perform."
                },
                params: {
                  type: "object",
                  description: "Parameters specific to the chosen action. E.g. {\"selector\": \"button\"} for query_selector."
                }
              },
              required: ["action"]
            }
          }
        }
      ];

      // Assemble History 
      const historyToPass: Message[] = isRecursive 
        ? [...injectedHistory, ...(toolResultAppend ? [toolResultAppend] : [])] 
        : [...messages, { role: 'user', content: userMessageContent } as Message];

      // Only Hermes models currently support WebLLM's native json schema tools
      const supportsNativeTools = activeModel && (
         activeModel.includes('Hermes-2-Pro-Llama-3-8B') || 
         activeModel.includes('Hermes-3-Llama-3.1-8B') ||
         activeModel.includes('Hermes-2-Pro-Mistral-7B')
      );
      
      const requestOptions: any = {
        messages: historyToPass,
        stream: true
      };

      if (supportsNativeTools) {
        requestOptions.tools = toolSchema;
        requestOptions.tool_choice = "auto";
      } else if (!isRecursive) {
        // Polyfill for models that lack native strict JSON tool calling
        const prmpt = `You are a universal browser debugging agent. You CANNOT see the user's browser tab by default. You MUST use the \`execute_browser_action\` tool to fetch info.

Available Actions for \`execute_browser_action\`:
1. "read_dom": Gets the full textual content and title of the page. No params needed.
2. "query_selector": Specify params {"selector": "css_selector"}. Returns text content of matching elements.
3. "get_styles": Specify params {"selector": "css_selector"}. Returns the computed CSS styles for the element.
4. "get_console_logs": Returns any javascript errors present on the page. No params needed.
5. "get_page_frameworks": Detects frontend stacks (React/Vue/etc) running on page.

To execute, you MUST output a single line starting EXACTLY with "CALL_TOOL:" followed by a valid JSON.
Example Read full DOM:
CALL_TOOL: {"name": "execute_browser_action", "arguments": {"action": "read_dom", "params": {}}}

Example Get Styles:
CALL_TOOL: {"name": "execute_browser_action", "arguments": {"action": "get_styles", "params": {"selector": "h1"}}}

CRITICAL: Do NOT guess or hallucinate. ALWAYS use CALL_TOOL first. Do not output any conversational text when calling a tool.`;

        requestOptions.messages = [
          { role: 'system', content: prmpt },
          ...historyToPass
        ];
      }

      const chunks = await engine.chat.completions.create(requestOptions) as unknown as AsyncIterable<any>

      let reply = ""
      let toolCallName = ""
      let toolCallArgs = ""
      let isToolCall = false;

      // Polyfill variables
      let polyfillExpression = ""
      let isPolyfill = false;

      for await (const chunk of chunks) {
        const delta = chunk.choices[0]?.delta;
        
        // Handle standard markdown tokens
        if (delta?.content) {
            reply += delta.content;
            
            // Check realtime for CALL_TOOL: prefix so we can UI update
            if (!supportsNativeTools && !isPolyfill && reply.includes("CALL_TOOL:")) {
                isPolyfill = true;
            }

            setMessages(prev => {
                const newM = [...prev]
                if (isPolyfill) {
                  const match = reply.match(/CALL_TOOL:\s*([^\n<]+)/);
                  let expr = match ? match[1].trim() : "...";
                  expr = expr.replace(/^```(json|javascript|js)?\s*/i, '').replace(/^[`'"]+|[`'"]+$/g, '');
                  newM[newM.length - 1].content = `> ⚡ **Executing Tool Request**: \n\`\`\`json\n${expr}\n\`\`\``;
                } else {
                  newM[newM.length - 1].content = reply;
                }
                return newM
            })
        }
        
        // Intercept Native Tool Calls from stream
        if (delta?.tool_calls && delta.tool_calls.length > 0) {
            isToolCall = true;
            const tc = delta.tool_calls[0];
            if (tc.function?.name) toolCallName += tc.function.name;
            if (tc.function?.arguments) toolCallArgs += tc.function.arguments;
            
            setMessages(prev => {
                const newM = [...prev]
                newM[newM.length - 1].content = `> ⚡ **Executing Tool**: ${toolCallName} \n\`\`\`json\n${toolCallArgs}\n\`\`\``;
                return newM
            })
        }
      }

      // Definitive parse after stream completes
      if (isPolyfill) {
         const match = reply.match(/CALL_TOOL:\s*([^\n<]+)/);
         if (match) {
            let expr = match[1].trim();
            expr = expr.replace(/^```(json|javascript|js)?\s*/i, '').replace(/^[`'"]+|[`'"]+$/g, '');
            polyfillExpression = expr;
         }
      }

      // If the LLM successfully finished generating a tool call Payload
      if (isToolCall || isPolyfill) {
         let toolResult = "";
         let success = false;
         
         const callId = "call_" + Math.random().toString(36).substring(7);

         let finalToolName = toolCallName;
         let finalArgs: any = {};

         try {
             if (!activeTabId) throw new Error('No Debugger is attached. Please attach to a local tab via Tab Inspector UI.');

             if (isPolyfill) {
                 const parsed = JSON.parse(polyfillExpression);
                 finalToolName = parsed.name;
                 finalArgs = parsed.arguments || {};
             } else {
                 if (toolCallArgs) {
                    finalArgs = JSON.parse(toolCallArgs);
                 }
             }

             // Deterministic Switchboard
             switch(finalToolName) {
                 case 'execute_browser_action': {
                     const action = finalArgs.action;
                     const params = finalArgs.params || {};

                     switch(action) {
                         case 'read_dom': {
                             const exp = `(() => {
                                 return "TITLE: " + document.title + "\\n\\nCONTENT:\\n" + document.body.innerText.substring(0, 3000);
                             })()`;
                             const res = await BrowserDebugger.evaluate(activeTabId, exp);
                             toolResult = String(res);
                             break;
                         }
                         case 'query_selector': {
                             if (!params.selector) throw new Error("Missing 'selector' property in params.");
                             const safeSelector = params.selector.replace(/"/g, '\\"');
                             const exp = `(() => {
                                 try {
                                   const el = document.querySelector("${safeSelector}");
                                   if (!el) return "Element '${safeSelector}' not found.";
                                   let resStr = el.outerHTML + "\\n" + el.innerText.trim();
                                   return "Match: " + (resStr.length > 2000 ? resStr.substring(0,2000) + '...' : resStr);
                                 } catch (err) { return "Invalid query: " + err.message; }
                             })()`;
                             const res = await BrowserDebugger.evaluate(activeTabId, exp);
                             toolResult = String(res);
                             break;
                         }
                         case 'get_styles': {
                             if (!params.selector) throw new Error("Missing 'selector' property in params.");
                             const safeSelector = params.selector.replace(/"/g, '\\"');
                             const exp = `(() => {
                                 try {
                                   const el = document.querySelector("${safeSelector}");
                                   if (!el) return "Element not found.";
                                   const styles = window.getComputedStyle(el);
                                   return "Color: " + styles.color + ", Background: " + styles.backgroundColor + ", Font: " + styles.fontFamily + ", Margin: " + styles.margin;
                                 } catch(e) { return "Style eval error: " + e.message; }
                             })()`;
                             const res = await BrowserDebugger.evaluate(activeTabId, exp);
                             toolResult = String(res);
                             break;
                         }
                         case 'get_console_logs': {
                             // We don't have CDP log interception natively active yet, fallback to a mocked or basic window.onerror read if possible, but for now we will inform the LLM.
                             toolResult = "Log interception disabled natively in current build. Use DOM extraction instead.";
                             break;
                         }
                         case 'get_page_frameworks': {
                             const exp = `(() => {
                                const fw = [];
                                if (window.React || document.querySelector('[data-reactroot], [data-reactid]')) fw.push('React');
                                if (window.__VUE__ || document.querySelector('[data-v-app]')) fw.push('Vue');
                                if (window.angular || document.querySelector('[ng-version]')) fw.push('Angular');
                                if (window.next) fw.push('Next.js');
                                return fw.length > 0 ? fw.join(', ') : 'No framework detected';
                             })()`;
                             const res = await BrowserDebugger.evaluate(activeTabId, exp);
                             toolResult = String(res);
                             break;
                         }
                         default:
                             throw new Error(`Action '${action}' is not defined.`);
                     }
                     break;
                 }
                 default:
                     throw new Error(`Tool '${finalToolName}' is not defined in Schema.`);
             }
             success = true;

         } catch(e) {
             toolResult = String(e);
             success = false;
         }
         
         // Format the history state to pass recursively
         let updatedHistory: Message[] = [];
         let recursiveResponseArg: Message | undefined = undefined;

         if (isPolyfill) {
             updatedHistory = [
                 ...historyToPass, 
                 { role: 'assistant', content: reply }
             ];
             recursiveResponseArg = { 
                 role: 'user', 
                 content: `[TOOL_RESULT for ${finalToolName}]:\n${toolResult}\nNow summarize the answer based on this context.` 
             };
         } else {
             const llmAssistantToolState: Message = {
               role: 'assistant',
               content: null as any,
               tool_calls: [{ id: callId, type: "function", function: { name: finalToolName, arguments: JSON.stringify(finalArgs) } }]
             };
             recursiveResponseArg = { 
               role: 'tool', 
               tool_call_id: callId, 
               name: finalToolName, 
               content: toolResult 
             };
             updatedHistory = [...historyToPass, llmAssistantToolState];
         }
         
         // Let the user see the result in UI before recursion finishes
         setMessages(prev => {
             const newM = [...prev];
             if (success) {
               newM[newM.length - 1].content += `\n> ✅ **Result**: \`${toolResult}\``
             } else {
               newM[newM.length - 1].content += `\n> ❌ **Failed**: ${toolResult}`
             }
             return newM;
         });

         // Call recursively so LLM can synthesize outcome
         await handleAgenticLoop(undefined, updatedHistory, recursiveResponseArg);
      }

    } catch (err) {
      console.error(err)
      setMessages(prev => [
        ...prev, 
        { role: 'assistant', content: '> ❌ Error executing Orchestrator pipeline.\n' + String(err) }
      ])
    } finally {
      if (!isRecursive) setIsGenerating(false)
    }
  }

  const exportSessionReport = async () => {
    if (messages.length === 0) {
      alert("No session data to export.");
      return;
    }

    let report = "# Specter Diagnostic Session\n\n";
    
    // Add Metadata
    report += "## Metadata\n";
    report += `- **Active Model**: ${activeModel || "None"}\n`;
    report += `- **Debugger Attached**: ${isDebuggerAttached ? 'Yes' : 'No'}\n`;
    report += `- **Timestamp**: ${new Date().toLocaleString()}\n`;

    if (activeTabId) {
      try {
        const tab = await BrowserDebugger.getActiveTab();
        if (tab && tab.url) {
           report += `- **Target URL**: ${tab.url}\n`;
        }
      } catch(e) {}
    }
    report += "\n---\n\n## Session Logs\n\n";

    // Format Messages
    messages.forEach((msg) => {
       if (msg.role === 'system') return; // Skip internal system alarm prompts
       
       report += `### [${msg.role.toUpperCase()}]\n`;
       if (msg.content) {
         report += `${msg.content}\n\n`;
       }
    });

    const blob = new Blob([report], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `specter-diagnostic-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleAgenticLoop(e as any)
    }
  }

  return (
    <div className="app-container">
      <header className="header">
        <Bot className="header-icon" size={24} />
        <h1>Specter local AI</h1>
        <div className="header-actions">
          <button 
            className="icon-btn"
            onClick={exportSessionReport}
            title="Export Diagnostic Report"
            disabled={messages.length === 0}
          >
            <FileText size={20} />
          </button>
          <button 
            className={`icon-btn ${showSettings ? 'active' : ''}`}
            onClick={() => setShowSettings(!showSettings)}
            title="Model Settings"
          >
            <Settings size={20} />
          </button>
        </div>
      </header>

      {/* Inspector Panel */}
      <section className="inspector-panel">
        <div className="inspector-header">
          <span className="inspector-title">Tab Inspector</span>
          <div className="inspector-actions">
            {!isDebuggerAttached ? (
              <button className="action-btn btn-primary btn-sm" onClick={handleAttachDebugger}>
                <Link2 size={14} /> Attach
              </button>
            ) : (
              <button className="action-btn btn-danger btn-sm" onClick={handleDetachDebugger}>
                <Unlink size={14} /> Detach
              </button>
            )}
          </div>
        </div>
        {isDebuggerAttached && (
          <div className="inspector-body">
            <button className="action-btn btn-outline btn-full" onClick={handleRunInspection}>
              <SearchCode size={14} /> Detect Framework
            </button>
            {inspectionResult && (
              <div className="inspection-result">{inspectionResult}</div>
            )}
          </div>
        )}
      </section>

      {showSettings && (
        <section className="settings-panel">
          <div className="settings-row">
            <select 
              className="model-select"
              value={selectedDropdownModel}
              onChange={(e) => setSelectedDropdownModel(e.target.value)}
              disabled={isCacheActionLoading}
            >
              {AVAILABLE_MODELS.map(id => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <div className="cache-status">
              {isModelCached ? (
                <span className="status-badge success"><CheckCircle size={14}/> Cached</span>
              ) : (
                <span className="status-badge pending">Not Downloaded</span>
              )}
            </div>
            <div className="model-actions">
              <button
                className={`action-btn ${defaultModel === selectedDropdownModel ? 'btn-primary' : 'btn-outline'}`}
                onClick={handleSetDefault}
                disabled={defaultModel === selectedDropdownModel}
                title="Set as Auto-Load Default"
              >
                <Star size={16} fill={defaultModel === selectedDropdownModel ? "currentColor" : "none"} /> 
                {defaultModel === selectedDropdownModel ? 'Default' : 'Make Default'}
              </button>
              {isModelCached && (
                <button 
                  className="action-btn btn-danger" 
                  onClick={handleDeleteCache}
                  disabled={isCacheActionLoading}
                  title="Delete from Cache"
                >
                  <Trash2 size={16} />
                </button>
              )}
              <button 
                className={`action-btn ${isModelCached ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => loadModel(selectedDropdownModel)}
                disabled={isCacheActionLoading || (activeModel === selectedDropdownModel)}
              >
                {isModelCached ? <><Play size={16}/> Load Model</> : <><Download size={16}/> Download & Load</>}
              </button>
            </div>
          </div>
        </section>
      )}

      <main className="chat-container">
        {!engine ? (
          <div className="loading-container">
            <Bot size={32} opacity={0.5} />
            <div className="loading-text">{progressMsg}</div>
          </div>
        ) : (
          messages.map((msg, idx) => (
            // Do not render raw 'tool' output arrays unless synthesized by LLM in assistant bubble.
            msg.role === 'tool' ? null : (
            <div key={idx} className={`message-wrapper ${msg.role}`}>
              <div className="message markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg.content || ""}
                </ReactMarkdown>
              </div>
            </div>
            )
          ))
        )}
        <div ref={chatEndRef} />
      </main>

      <footer className="input-container">
        <form className="input-form" onSubmit={(e) => handleAgenticLoop(e)}>
          <textarea
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={engine ? `Message ${activeModel}...` : "Waiting for model..."}
            disabled={!engine || isGenerating}
            rows={1}
          />
          <button 
            type="submit" 
            className="send-button"
            disabled={!engine || !input.trim() || isGenerating}
          >
            <Send size={20} />
          </button>
        </form>
      </footer>
    </div>
  )
}

export default App

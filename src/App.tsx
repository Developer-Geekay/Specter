import { useEffect, useState, useRef } from 'react'
import { CreateWebWorkerMLCEngine, prebuiltAppConfig, hasModelInCache, deleteModelAllInfoInCache } from '@mlc-ai/web-llm'
import type { InitProgressReport, MLCEngineInterface } from '@mlc-ai/web-llm'
import { Bot, Send, Settings, Trash2, Download, Play, CheckCircle, Link2, Unlink, SearchCode, Star } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BrowserDebugger } from './debugger'
import './App.css'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const AVAILABLE_MODELS = prebuiltAppConfig.model_list
  .filter(m => m.model_id.includes('SmolLM') || m.model_id.includes('Llama-3.2-1B'))
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
    // Only register listener once globally or conditionally. We do it conditionally.
    BrowserDebugger.onDetach(handleDetach)
    return () => BrowserDebugger.removeOnDetach(handleDetach)
  }, [activeTabId])

  // Tab Context Switching
  useEffect(() => {
    const onTabActivated = (activeInfo: { tabId: number; windowId: number }) => {
      // If we switch to a new tab, detach the old debugger.
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
      
      // Optionally echo to chat if engine is running
      if (engine) {
          setMessages(prev => [...prev, { role: 'assistant', content: `**System Context Check**:\nFramework Stack: \`${result}\`` }])
      }
    } catch (err) {
      setInspectionResult("Error: " + err)
    }
  }

  // Model Lifecycle
  const loadModel = async (modelId: string) => {
    try {
      setIsCacheActionLoading(true)
      setProgressMsg(`Initializing ${modelId}...`)
      // Creating a new worker for each load ensures clean state
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
        { role: 'assistant', content: `System initialized. Active Model: **${modelId}**.\n\nRunning fully offline. How can I help you debug today?` }
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

  // Init Auto-load logic
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || !engine || isGenerating) return

    const userMessage: Message = { role: 'user', content: input.trim() }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsGenerating(true)

    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      const history = [...messages, userMessage].map(m => ({
        role: m.role,
        content: m.content
      }))

      const chunks = await engine.chat.completions.create({
        messages: history as any,
        stream: true,
      })

      let reply = ""
      for await (const chunk of chunks) {
        const delta = chunk.choices[0]?.delta?.content || ""
        reply += delta
        setMessages(prev => {
          const newM = [...prev]
          newM[newM.length - 1].content = reply
          return newM
        })
      }
    } catch (err) {
      console.error(err)
      setMessages(prev => [
        ...prev, 
        { role: 'assistant', content: 'Error generating response.' }
      ])
    } finally {
      setIsGenerating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <div className="app-container">
      <header className="header">
        <Bot className="header-icon" size={24} />
        <h1>Specter local AI</h1>
        <div className="header-actions">
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
            <div key={idx} className={`message-wrapper ${msg.role}`}>
              <div className="message markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg.content}
                </ReactMarkdown>
              </div>
            </div>
          ))
        )}
        <div ref={chatEndRef} />
      </main>

      <footer className="input-container">
        <form className="input-form" onSubmit={handleSubmit}>
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

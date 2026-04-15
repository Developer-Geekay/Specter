/// <reference types="chrome"/>

export class BrowserDebugger {
  private static protocolVersion = '1.3';

  // Get currently active tab
  static async getActiveTab(): Promise<chrome.tabs.Tab | null> {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs.length > 0) {
          resolve(tabs[0]);
        } else {
          resolve(null);
        }
      });
    });
  }

  // Attach the debugger
  static async attach(tabId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const target = { tabId };
      chrome.debugger.attach(target, this.protocolVersion, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError.message);
        } else {
          resolve();
        }
      });
    });
  }

  // Detach the debugger
  static async detach(tabId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const target = { tabId };
      chrome.debugger.detach(target, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError.message);
        } else {
          resolve();
        }
      });
    });
  }

  // Execute JavaScript on the target page
  static async evaluate(tabId: number, expression: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const target = { tabId };
      chrome.debugger.sendCommand(
        target,
        'Runtime.evaluate',
        { expression, returnByValue: true },
        (result: any) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError.message);
            return;
          }
          if (result && result.exceptionDetails) {
            reject(result.exceptionDetails.exception?.description || 'Evaluation failed');
            return;
          }
          resolve(result.result?.value);
        }
      );
    });
  }

  // Set up an onDetach listener
  static onDetach(callback: (source: chrome.debugger.Debuggee, reason: string) => void) {
    chrome.debugger.onDetach.addListener(callback);
  }

  static removeOnDetach(callback: (source: chrome.debugger.Debuggee, reason: string) => void) {
    chrome.debugger.onDetach.removeListener(callback);
  }
}

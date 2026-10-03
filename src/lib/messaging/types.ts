import type { Article } from '../extract/types';
import type { ErrorInfo } from '../errors';
import type { ProviderNotice } from '../providers/types';
import type { StyleId } from '../settings-schema';

export const PORT_SUMMARIZE = 'briefme:summarize';
export const PORT_CHAT = 'briefme:chat';

/** Content/panel -> background, over a port. */
export type ClientMessage =
  | {
      type: 'summarize';
      article: Article;
      style?: StyleId;
      language?: string;
      /** Skip the cache. */
      refresh?: boolean;
    }
  | {
      type: 'chat';
      article: Article;
      summary: string;
      history: { role: 'user' | 'assistant'; content: string }[];
      question: string;
    };

/** Background -> content/panel, over a port. */
export type ServerMessage =
  | { type: 'status'; phase: 'connecting' | 'chunk' | 'writing'; index?: number; total?: number }
  | { type: 'token'; text: string }
  | { type: 'replace'; text: string }
  | { type: 'notice'; notice: ProviderNotice }
  | { type: 'truncated'; kept: number; total: number }
  | {
      type: 'done';
      summary: string;
      model: string;
      cached: boolean;
      readMinutes: number;
      elapsedSec: number;
      tokensEstimate: number;
    }
  | { type: 'error'; error: ErrorInfo };

/** Background -> tab, via tabs.sendMessage. */
export type TabMessage =
  | { type: 'briefme:run'; force?: boolean; onlyIfReaderable?: boolean }
  | {
      type: 'briefme:extract';
      /** Use the page selection when there is one. Off for digests, which want the whole page. */
      useSelection?: boolean;
      /** Skip the sensitive-page check (user confirmed). */
      force?: boolean;
    }
  | { type: 'briefme:extract-html'; html: string; url: string }
  | { type: 'briefme:run-article'; article: Article }
  | { type: 'briefme:show-error'; error: ErrorInfo };

export type ExtractResponse = { article: Article } | { error: ErrorInfo };

/** Messages to the background from extension pages. */
export type RuntimeMessage =
  | { type: 'briefme:open-options' }
  | { type: 'briefme:auto' }
  | { type: 'briefme:panel-retry'; tabId: number };

/** One job slot per browser window, so panels in different windows do not see each other's jobs. */
export const PANEL_JOB_PREFIX = 'panelJob:';
export const panelJobKey = (windowId: number): string => `${PANEL_JOB_PREFIX}${windowId}`;

export interface PanelJob {
  id: string;
  tabId: number;
  windowId: number;
  article?: Article;
  error?: ErrorInfo;
}

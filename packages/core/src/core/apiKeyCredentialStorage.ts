/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { HybridTokenStorage } from '../mcp/token-storage/hybrid-token-storage.js';
import type { OAuthCredentials } from '../mcp/token-storage/types.js';
import { debugLogger } from '../utils/debugLogger.js';

const KEYCHAIN_SERVICE_NAME = 'gemini-cli-api-key';
const DEFAULT_API_KEY_ENTRY = 'default-api-key';
const DEEPSEEK_API_KEY_ENTRY = 'deepseek-api-key';
const OPENAI_COMPAT_API_KEY_ENTRY = 'openai-compatible-api-key';

const storage = new HybridTokenStorage(KEYCHAIN_SERVICE_NAME);

/**
 * Load cached API key
 */
export async function loadApiKey(): Promise<string | null> {
  try {
    const credentials = await storage.getCredentials(DEFAULT_API_KEY_ENTRY);

    if (credentials?.token?.accessToken) {
      return credentials.token.accessToken;
    }

    return null;
  } catch (error: unknown) {
    // Log other errors but don't crash, just return null so user can re-enter key
    debugLogger.error('Failed to load API key from storage:', error);
    return null;
  }
}

export async function loadOpenAICompatApiKey(): Promise<string | null> {
  try {
    const credentials = await storage.getCredentials(OPENAI_COMPAT_API_KEY_ENTRY);

    if (credentials?.token?.accessToken) {
      return credentials.token.accessToken;
    }

    return null;
  } catch (error: unknown) {
    debugLogger.error('Failed to load OpenAI-compatible API key from storage:', error);
    return null;
  }
}

export async function loadDeepSeekApiKey(): Promise<string | null> {
  try {
    const credentials = await storage.getCredentials(DEEPSEEK_API_KEY_ENTRY);

    if (credentials?.token?.accessToken) {
      return credentials.token.accessToken;
    }

    return null;
  } catch (error: unknown) {
    debugLogger.error('Failed to load DeepSeek API key from storage:', error);
    return null;
  }
}

/**
 * Save API key
 */
export async function saveApiKey(
  apiKey: string | null | undefined,
): Promise<void> {
  if (!apiKey || apiKey.trim() === '') {
    try {
      await storage.deleteCredentials(DEFAULT_API_KEY_ENTRY);
    } catch (error: unknown) {
      // Ignore errors when deleting, as it might not exist
      debugLogger.warn('Failed to delete API key from storage:', error);
    }
    return;
  }

  // Wrap API key in OAuthCredentials format as required by HybridTokenStorage
  const credentials: OAuthCredentials = {
    serverName: DEFAULT_API_KEY_ENTRY,
    token: {
      accessToken: apiKey,
      tokenType: 'ApiKey',
    },
    updatedAt: Date.now(),
  };

  await storage.setCredentials(credentials);
}

export async function saveOpenAICompatApiKey(
  apiKey: string | null | undefined,
): Promise<void> {
  if (!apiKey || apiKey.trim() === '') {
    try {
      await storage.deleteCredentials(OPENAI_COMPAT_API_KEY_ENTRY);
    } catch (error: unknown) {
      debugLogger.warn(
        'Failed to delete OpenAI-compatible API key from storage:',
        error,
      );
    }
    return;
  }

  const credentials: OAuthCredentials = {
    serverName: OPENAI_COMPAT_API_KEY_ENTRY,
    token: {
      accessToken: apiKey,
      tokenType: 'ApiKey',
    },
    updatedAt: Date.now(),
  };

  await storage.setCredentials(credentials);
}

export async function saveDeepSeekApiKey(
  apiKey: string | null | undefined,
): Promise<void> {
  if (!apiKey || apiKey.trim() === '') {
    try {
      await storage.deleteCredentials(DEEPSEEK_API_KEY_ENTRY);
    } catch (error: unknown) {
      debugLogger.warn('Failed to delete DeepSeek API key from storage:', error);
    }
    return;
  }

  const credentials: OAuthCredentials = {
    serverName: DEEPSEEK_API_KEY_ENTRY,
    token: {
      accessToken: apiKey,
      tokenType: 'ApiKey',
    },
    updatedAt: Date.now(),
  };

  await storage.setCredentials(credentials);
}

/**
 * Clear cached API key
 */
export async function clearApiKey(): Promise<void> {
  try {
    await storage.deleteCredentials(DEFAULT_API_KEY_ENTRY);
  } catch (error: unknown) {
    debugLogger.error('Failed to clear API key from storage:', error);
  }
}

export async function clearDeepSeekApiKey(): Promise<void> {
  try {
    await storage.deleteCredentials(DEEPSEEK_API_KEY_ENTRY);
  } catch (error: unknown) {
    debugLogger.error('Failed to clear DeepSeek API key from storage:', error);
  }
}

export async function clearOpenAICompatApiKey(): Promise<void> {
  try {
    await storage.deleteCredentials(OPENAI_COMPAT_API_KEY_ENTRY);
  } catch (error: unknown) {
    debugLogger.error(
      'Failed to clear OpenAI-compatible API key from storage:',
      error,
    );
  }
}

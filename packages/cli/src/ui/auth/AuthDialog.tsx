/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useState } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { RadioButtonSelect } from '../components/shared/RadioButtonSelect.js';
import type {
  LoadableSettingScope,
  LoadedSettings,
} from '../../config/settings.js';
import { SettingScope } from '../../config/settings.js';
import {
  AuthType,
  clearCachedCredentialFile,
  type Config,
} from '@google/gemini-cli-core';
import { useKeypress } from '../hooks/useKeypress.js';
import { AuthState } from '../types.js';
import { runExitCleanup } from '../../utils/cleanup.js';
import { validateAuthMethodWithSettings } from './useAuth.js';
import { RELAUNCH_EXIT_CODE } from '../../utils/processUtils.js';
import { OpenAICompatConfigDialog } from './OpenAICompatConfigDialog.js';
import { useUIActions } from '../contexts/UIActionsContext.js';

interface AuthDialogProps {
  config: Config;
  settings: LoadedSettings;
  setAuthState: (state: AuthState) => void;
  authError: string | null;
  onAuthError: (error: string | null) => void;
  setAuthContext: (context: { requiresRestart?: boolean }) => void;
}

type AuthSelectionValue =
  | 'login_with_google'
  | 'compute_adc'
  | 'gemini_api_key'
  | 'deepseek_api_key'
  | 'openai_compatible_api_key'
  | 'vertex_ai';

export function AuthDialog({
  config,
  settings,
  setAuthState,
  authError,
  onAuthError,
  setAuthContext,
}: AuthDialogProps): React.JSX.Element {
  const uiActions = useUIActions();
  const [exiting, setExiting] = useState(false);
  let items = [
    {
      label: 'Login with Google',
      value: 'login_with_google' as const,
      key: 'login_with_google',
    },
    ...(process.env['CLOUD_SHELL'] === 'true'
      ? [
          {
            label: 'Use Cloud Shell user credentials',
            value: 'compute_adc' as const,
            key: 'compute_adc',
          },
        ]
      : process.env['GEMINI_CLI_USE_COMPUTE_ADC'] === 'true'
        ? [
            {
              label: 'Use metadata server application default credentials',
              value: 'compute_adc' as const,
              key: 'compute_adc',
            },
          ]
        : []),
    {
      label: 'Use Gemini API Key',
      value: 'gemini_api_key' as const,
      key: 'gemini_api_key',
    },
    {
      label: 'DeepSeek API Key',
      value: 'deepseek_api_key' as const,
      key: 'deepseek_api_key',
    },
    {
      label: 'Custom (OpenAI-compatible) API Key',
      value: 'openai_compatible_api_key' as const,
      key: 'openai_compatible_api_key',
    },
    {
      label: 'Vertex AI',
      value: 'vertex_ai' as const,
      key: 'vertex_ai',
    },
  ];

  if (settings.merged.security.auth.enforcedType) {
    items = items.filter((item) => {
      if (settings.merged.security.auth.enforcedType === AuthType.LOGIN_WITH_GOOGLE) {
        return item.value === 'login_with_google';
      }
      if (settings.merged.security.auth.enforcedType === AuthType.COMPUTE_ADC) {
        return item.value === 'compute_adc';
      }
      if (settings.merged.security.auth.enforcedType === AuthType.USE_GEMINI) {
        return (
          item.value === 'gemini_api_key' ||
          item.value === 'deepseek_api_key' ||
          item.value === 'openai_compatible_api_key'
        );
      }
      if (settings.merged.security.auth.enforcedType === AuthType.USE_VERTEX_AI) {
        return item.value === 'vertex_ai';
      }
      return false;
    });
  }

  let defaultAuthType = null;
  const defaultAuthTypeEnv = process.env['GEMINI_DEFAULT_AUTH_TYPE'];
  if (
    defaultAuthTypeEnv &&
    Object.values(AuthType).includes(defaultAuthTypeEnv as AuthType)
  ) {
    defaultAuthType = defaultAuthTypeEnv as AuthType;
  }

  const defaultSelection: AuthSelectionValue | null = defaultAuthType
    ? defaultAuthType === AuthType.LOGIN_WITH_GOOGLE
      ? 'login_with_google'
      : defaultAuthType === AuthType.COMPUTE_ADC
        ? 'compute_adc'
        : defaultAuthType === AuthType.USE_VERTEX_AI
          ? 'vertex_ai'
          : defaultAuthType === AuthType.USE_GEMINI
            ? 'gemini_api_key'
            : null
    : null;

  let initialAuthIndex = items.findIndex((item) => {
    if (settings.merged.security.auth.selectedType) {
      if (settings.merged.security.auth.selectedType === AuthType.LOGIN_WITH_GOOGLE) {
        return item.value === 'login_with_google';
      }
      if (settings.merged.security.auth.selectedType === AuthType.COMPUTE_ADC) {
        return item.value === 'compute_adc';
      }
      if (settings.merged.security.auth.selectedType === AuthType.USE_VERTEX_AI) {
        return item.value === 'vertex_ai';
      }
      if (settings.merged.security.auth.selectedType === AuthType.USE_GEMINI) {
        return item.value === 'gemini_api_key';
      }
      return false;
    }

    if (defaultSelection) {
      return item.value === defaultSelection;
    }

    if (process.env['GEMINI_API_KEY']) {
      return item.value === 'gemini_api_key';
    }

    return item.value === 'login_with_google';
  });
  if (settings.merged.security.auth.enforcedType) {
    initialAuthIndex = 0;
  }

  const onSelect = useCallback(
    async (selection: AuthSelectionValue | undefined, scope: LoadableSettingScope) => {
      if (exiting) {
        return;
      }
      if (selection) {
        if (selection === 'login_with_google') {
          setAuthContext({ requiresRestart: true });
        } else {
          setAuthContext({});
        }
        await clearCachedCredentialFile();

        if (selection === 'deepseek_api_key') {
          process.env['GEMINI_CLI_PROVIDER'] = 'deepseek';
        } else if (selection === 'openai_compatible_api_key') {
          process.env['GEMINI_CLI_PROVIDER'] = 'openai_compatible';
        } else if (selection === 'gemini_api_key') {
          process.env['GEMINI_CLI_PROVIDER'] = 'gemini';
        } else if (selection === 'vertex_ai') {
          delete process.env['GEMINI_CLI_PROVIDER'];
        }

        const authType: AuthType =
          selection === 'login_with_google'
            ? AuthType.LOGIN_WITH_GOOGLE
            : selection === 'compute_adc'
              ? AuthType.COMPUTE_ADC
              : selection === 'vertex_ai'
                ? AuthType.USE_VERTEX_AI
                : AuthType.USE_GEMINI;

        settings.setValue(scope, 'security.auth.selectedType', authType);
        if (
          authType === AuthType.LOGIN_WITH_GOOGLE &&
          config.isBrowserLaunchSuppressed()
        ) {
          setExiting(true);
          setTimeout(async () => {
            await runExitCleanup();
            process.exit(RELAUNCH_EXIT_CODE);
          }, 100);
          return;
        }

        if (authType === AuthType.USE_GEMINI) {
          if (selection === 'deepseek_api_key') {
            // Always show input dialog to allow user to enter or update API key
            setAuthState(AuthState.AwaitingApiKeyInput);
            return;
          }

          if (selection === 'openai_compatible_api_key') {
            const mergedProviders = (settings.merged as unknown as {
              providers?: {
                openai_compatible?: {
                  baseUrl?: string;
                  defaultModel?: string;
                  temperature?: number;
                };
              };
            }).providers;

            uiActions.setCustomDialog(
              <OpenAICompatConfigDialog
                defaultScope={SettingScope.User}
                defaultBaseUrl={
                  mergedProviders?.openai_compatible?.baseUrl ||
                  'https://api.openai.com/v1'
                }
                defaultDefaultModel={
                  mergedProviders?.openai_compatible?.defaultModel || 'gpt-4o-mini'
                }
                defaultTemperature={
                  mergedProviders?.openai_compatible?.temperature ?? 0.2
                }
                onCancel={() => {
                  uiActions.setCustomDialog(null);
                }}
                onComplete={(result) => {
                  uiActions.setCustomDialog(null);
                  settings.setValue(
                    result.scope,
                    'providers.openai_compatible.baseUrl',
                    result.baseUrl,
                  );
                  settings.setValue(
                    result.scope,
                    'providers.openai_compatible.defaultModel',
                    result.defaultModel,
                  );
                  settings.setValue(
                    result.scope,
                    'providers.openai_compatible.temperature',
                    result.temperature,
                  );

                  setAuthState(AuthState.AwaitingApiKeyInput);
                }}
              />,
            );

            return;
          }

          if (process.env['GEMINI_API_KEY'] !== undefined) {
            setAuthState(AuthState.Unauthenticated);
            return;
          } else {
            setAuthState(AuthState.AwaitingApiKeyInput);
            return;
          }
        }
      }
      setAuthState(AuthState.Unauthenticated);
    },
    [settings, config, setAuthState, exiting, setAuthContext, uiActions],
  );

  const handleAuthSelect = (selection: AuthSelectionValue) => {
    if (selection === 'deepseek_api_key') {
      process.env['GEMINI_CLI_PROVIDER'] = 'deepseek';
    } else if (selection === 'openai_compatible_api_key') {
      process.env['GEMINI_CLI_PROVIDER'] = 'openai_compatible';
    } else if (selection === 'gemini_api_key') {
      process.env['GEMINI_CLI_PROVIDER'] = 'gemini';
    } else if (selection === 'vertex_ai') {
      delete process.env['GEMINI_CLI_PROVIDER'];
    }

    const authMethod: AuthType =
      selection === 'login_with_google'
        ? AuthType.LOGIN_WITH_GOOGLE
        : selection === 'compute_adc'
          ? AuthType.COMPUTE_ADC
          : selection === 'vertex_ai'
            ? AuthType.USE_VERTEX_AI
            : AuthType.USE_GEMINI;

    const error = validateAuthMethodWithSettings(authMethod, settings);
    if (error) {
      onAuthError(error);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      onSelect(selection, SettingScope.User);
    }
  };

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        // Prevent exit if there is an error message.
        // This means they user is not authenticated yet.
        if (authError) {
          return true;
        }
        if (settings.merged.security.auth.selectedType === undefined) {
          // Prevent exiting if no auth method is set
          onAuthError(
            'You must select an auth method to proceed. Press Ctrl+C twice to exit.',
          );
          return true;
        }
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        onSelect(undefined, SettingScope.User);
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  if (exiting) {
    return (
      <Box
        borderStyle="round"
        borderColor={theme.border.focused}
        flexDirection="row"
        padding={1}
        width="100%"
        alignItems="flex-start"
      >
        <Text color={theme.text.primary}>
          Logging in with Google... Restarting Gemini CLI to continue.
        </Text>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border.focused}
      flexDirection="row"
      padding={1}
      width="100%"
      alignItems="flex-start"
    >
      <Text color={theme.text.accent}>? </Text>
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color={theme.text.primary}>
          Get started
        </Text>
        <Box marginTop={1}>
          <Text color={theme.text.primary}>
            How would you like to authenticate for this project?
          </Text>
        </Box>
        <Box marginTop={1}>
          <RadioButtonSelect
            items={items}
            initialIndex={initialAuthIndex}
            onSelect={handleAuthSelect}
            onHighlight={() => {
              onAuthError(null);
            }}
          />
        </Box>
        {authError && (
          <Box marginTop={1}>
            <Text color={theme.status.error}>{authError}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>(Use Enter to select)</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.text.primary}>
            Terms of Services and Privacy Notice for Gemini CLI
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.text.link}>
            {
              'https://github.com/google-gemini/gemini-cli/blob/main/docs/tos-privacy.md'
            }
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

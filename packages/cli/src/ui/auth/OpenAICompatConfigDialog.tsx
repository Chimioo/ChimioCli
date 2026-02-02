/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { RadioButtonSelect } from '../components/shared/RadioButtonSelect.js';
import { TextInput } from '../components/shared/TextInput.js';
import { useTextBuffer } from '../components/shared/text-buffer.js';
import { useUIState } from '../contexts/UIStateContext.js';
import type { LoadableSettingScope } from '../../config/settings.js';
import { SettingScope } from '../../config/settings.js';

type Step = 'scope' | 'baseUrl' | 'defaultModel' | 'temperature';

type Props = {
  defaultScope?: LoadableSettingScope;
  defaultBaseUrl?: string;
  defaultDefaultModel?: string;
  defaultTemperature?: number;
  onCancel: () => void;
  onComplete: (result: {
    scope: LoadableSettingScope;
    baseUrl: string;
    defaultModel: string;
    temperature: number;
  }) => void;
};

export function OpenAICompatConfigDialog({
  defaultScope = SettingScope.User,
  defaultBaseUrl = 'https://api.openai.com/v1',
  defaultDefaultModel = 'gpt-4o-mini',
  defaultTemperature = 0.2,
  onCancel,
  onComplete,
}: Props): React.JSX.Element {
  const { terminalWidth } = useUIState();
  const viewportWidth = terminalWidth - 8;

  const [step, setStep] = useState<Step>('scope');
  const [scope, setScope] = useState<LoadableSettingScope>(defaultScope);
  const [baseUrl, setBaseUrl] = useState<string>(defaultBaseUrl);
  const [defaultModel, setDefaultModel] = useState<string>(defaultDefaultModel);
  const [temperature, setTemperature] = useState<number>(defaultTemperature);
  const [error, setError] = useState<string | null>(null);

  const title =
    step === 'scope'
      ? 'OpenAI-compatible Provider'
      : step === 'baseUrl'
        ? 'OpenAI-compatible Base URL'
        : step === 'defaultModel'
          ? 'OpenAI-compatible Default Model'
          : 'OpenAI-compatible Temperature';

  const description =
    step === 'scope'
      ? 'Choose where to save this configuration (Workspace overrides User).'
      : step === 'baseUrl'
        ? 'Enter the base URL for the OpenAI-compatible API (must support /chat/completions).'
        : step === 'defaultModel'
          ? 'Enter the default model name.'
          : 'Enter temperature (e.g. 0.2).';

  const inputFilter = useMemo(() => {
    if (step === 'temperature') {
      return (text: string) =>
        text.replace(/[^0-9.-]/g, '').replace(/[\r\n]/g, '');
    }
    return (text: string) => text.replace(/[\r\n]/g, '');
  }, [step]);

  const initialText =
    step === 'baseUrl'
      ? baseUrl
      : step === 'defaultModel'
        ? defaultModel
        : step === 'temperature'
          ? String(temperature)
          : '';

  const buffer = useTextBuffer({
    initialText,
    initialCursorOffset: initialText.length,
    viewport: {
      width: viewportWidth,
      height: 4,
    },
    isValidPath: () => false,
    inputFilter,
    singleLine: true,
  });

  const handleSubmitText = (value: string) => {
    setError(null);
    if (step === 'baseUrl') {
      const v = value.trim();
      if (!v) {
        setError('Base URL cannot be empty.');
        return;
      }
      setBaseUrl(v);
      setStep('defaultModel');
      return;
    }

    if (step === 'defaultModel') {
      const v = value.trim();
      if (!v) {
        setError('Default model cannot be empty.');
        return;
      }
      setDefaultModel(v);
      setStep('temperature');
      return;
    }

    if (step === 'temperature') {
      const v = value.trim();
      const parsed = Number(v);
      if (!Number.isFinite(parsed)) {
        setError('Temperature must be a number.');
        return;
      }
      setTemperature(parsed);
      onComplete({
        scope,
        baseUrl,
        defaultModel,
        temperature: parsed,
      });
    }
  };

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border.focused}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold color={theme.text.primary}>
        {title}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.text.primary}>{description}</Text>
      </Box>

      {step === 'scope' ? (
        <Box marginTop={1}>
          <RadioButtonSelect
            items={[
              {
                label: 'User (global default)',
                value: SettingScope.User as LoadableSettingScope,
                key: 'user',
              },
              {
                label: 'Workspace (override for this project)',
                value: SettingScope.Workspace as LoadableSettingScope,
                key: 'workspace',
              },
            ]}
            initialIndex={scope === SettingScope.Workspace ? 1 : 0}
            onSelect={(value) => {
              setScope(value);
              setStep('baseUrl');
            }}
          />
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="row">
          <Box
            borderStyle="round"
            borderColor={theme.border.default}
            paddingX={1}
            flexGrow={1}
          >
            <TextInput
              buffer={buffer}
              onSubmit={handleSubmitText}
              onCancel={onCancel}
              placeholder={
                step === 'baseUrl'
                  ? 'https://api.openai.com/v1'
                  : step === 'defaultModel'
                    ? 'gpt-4o-mini'
                    : '0.2'
              }
            />
          </Box>
        </Box>
      )}

      {error && (
        <Box marginTop={1}>
          <Text color={theme.status.error}>{error}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.text.secondary}>
          (Press Enter to continue, Esc to cancel)
        </Text>
      </Box>
    </Box>
  );
}

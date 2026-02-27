import Editor, { DiffEditor, useMonaco } from '@monaco-editor/react';
import { type FC, useEffect, useState } from 'react';

// Themes
import BrillianceBlack from './themes/BrillianceBlack';
import GithubDark from './themes/GithubDark';

type Props = {
  filename: string;
  path?: string;
  height?: string | number;
  language?: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  diff?: boolean;
  original?: string;
};

const CodeEditor: FC<Props> = ({
  height,
  language,
  filename,
  path,
  value,
  onChange,
  readOnly,
  diff,
  original,
}) => {
  // If uncontrolled, define our state control here
  const [controlledValue, setControlledValue] = useState(value);
  const monaco = useMonaco();
  const [lang, setLang] = useState<string | undefined>(language);

  useEffect(() => {
    if (monaco) {
      // Define all of our themes
      monaco.editor.defineTheme('github-dark', GithubDark);
      monaco.editor.defineTheme('brilliance-black', BrillianceBlack);
    }

    async function detectLanguage() {
      try {
        const detectLangFn = (window as unknown as { detectLanguage?: (opts: { filename: string; contents: string }) => Promise<string | undefined> }).detectLanguage;
        if (!detectLangFn) return;
        const detected: string | undefined = await detectLangFn({
          filename,
          contents: value,
        });
        if (detected) {
          setLang(detected);
        }
      } catch (err: unknown) {
        console.error('Failed to detect language', err);
      }
    }

    if (!lang) {
      detectLanguage().catch((err: unknown) => { console.error(err); });
    }
  }, [monaco, filename, value, lang]);

  /**
   * If we are using controlled, we need to handle the change event
   */
  const handleChange = (val: string) => {
    if (onChange) {
      onChange(val);
      return;
    }

    setControlledValue(val);
  };

  if (diff && original && lang) {
    return (
      <DiffEditor
        theme={lang === 'nginx' ? 'nginx-theme-dark' : 'vs-dark'}
        language={lang}
        original={original}
        modified={value || controlledValue}
        height={height ?? '100%'}
        options={{ readOnly, fontSize: 11 }}
      />
    );
  }

  if (lang) {
    return (
      <Editor
        theme={lang === 'nginx' ? 'nginx-theme-dark' : 'vs-dark'}
        language={lang}
        value={
          lang === 'json'
            ? // pretty print it
              JSON.stringify(JSON.parse(value) as unknown, null, 2)
            : value || controlledValue
        }
        onChange={(v) => {
          handleChange(v || '');
        }}
        height={height ?? '100%'}
        path={path}
        options={{ readOnly, fontSize: 11 }}
      />
    );
  }

  return null;
};

export default CodeEditor;

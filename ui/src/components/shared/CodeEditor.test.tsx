import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CodeEditor from './CodeEditor';

vi.mock('@monaco-editor/react', () => ({
  default: ({ path }: { path?: string }) => <div data-testid="editor" data-path={path} />,
  useMonaco: () => null,
  DiffEditor: ({ originalModelPath, modifiedModelPath }: { originalModelPath?: string; modifiedModelPath?: string }) => (
    <div data-testid="diff" data-original={originalModelPath} data-modified={modifiedModelPath} />
  ),
}));

const host = window as Window & { __omniviewEditorSchemaBoundary?: React.ComponentType<{ pluginID: string; connectionID: string; resourceType?: string; modelPath?: string; children: React.ReactNode }> };
afterEach(() => { cleanup(); delete host.__omniviewEditorSchemaBoundary; });

describe('host schema demand lifecycle', () => {
  it('delegates demand and waits for the host before mounting Monaco', () => {
    let applied = false;
    const scopes = vi.fn();
    host.__omniviewEditorSchemaBoundary = ({ children, ...scope }) => {
      scopes(scope);
      return applied ? <>{children}</> : <div role="status">Applying schemas</div>;
    };
    const props = { filename: 'draft.yaml', language: 'yaml', value: 'kind: Pod', path: 'file:///catalog/pods/draft.yaml', schemaScope: { pluginID: 'kubernetes', connectionID: 'first', resourceType: 'k8s:/pods' } };
    const view = render(<CodeEditor {...props} />);
    expect(screen.queryByTestId('editor')).toBeNull();
    expect(scopes).toHaveBeenLastCalledWith({ ...props.schemaScope, modelPath: props.path });
    applied = true;
    view.rerender(<CodeEditor {...props} />);
    expect(screen.getByTestId('editor').getAttribute('data-path')).toMatch(/^file:\/\/\/catalog\/pods\/.+-draft\.yaml$/);
    const firstPath = screen.getByTestId('editor').getAttribute('data-path');
    view.rerender(<CodeEditor {...props} value="kind: Service" />);
    expect(screen.getByTestId('editor').getAttribute('data-path')).toBe(firstPath);
    view.rerender(<CodeEditor {...props} schemaScope={{ ...props.schemaScope, connectionID: 'second' }} />);
    expect(scopes).toHaveBeenLastCalledWith({ ...props.schemaScope, connectionID: 'second', modelPath: props.path });
    expect(screen.getByTestId('editor').getAttribute('data-path')).not.toBe(firstPath);
  });

  it('keeps source editing usable and warns when the host bridge is absent', () => {
    render(<CodeEditor filename="draft.yaml" language="yaml" value="kind: Pod" schemaScope={{ pluginID: 'kubernetes', connectionID: 'cluster' }} />);
    expect(screen.getByRole('alert').textContent).toContain('this host does not support');
    expect(screen.getByTestId('editor')).toBeTruthy();
  });

  it('does not acquire schemas for an unscoped preview', () => {
    const boundary = vi.fn(() => null);
    host.__omniviewEditorSchemaBoundary = boundary;
    render(<CodeEditor filename="private.yaml" path="inmemory://private/preview" language="yaml" value="redacted" />);
    expect(boundary).not.toHaveBeenCalled();
    expect(screen.getByTestId('editor').getAttribute('data-path')).toBe('inmemory://private/preview');
  });
});

it('gives concurrent drafts distinct models within the same schema directory', () => {
  host.__omniviewEditorSchemaBoundary = ({ children }) => <>{children}</>;
  const scope = { pluginID: 'kubernetes', connectionID: 'cluster', resourceType: 'k8s:/pods' };
  const editors = (first: boolean, second: boolean) => <>
    {first && <CodeEditor key="first" schemaScope={scope} filename="draft.yaml" path="file:///catalog/pods/draft.yaml" language="yaml" value="first" />}
    {second && <CodeEditor key="second" schemaScope={scope} filename="draft.yaml" path="file:///catalog/pods/draft.yaml" language="yaml" value="second" />}
  </>;
  const view = render(editors(true, true));
  const paths = screen.getAllByTestId('editor').map((editor) => editor.getAttribute('data-path'));
  expect(new Set(paths).size).toBe(2);
  paths.forEach((path) => expect(path).toMatch(/^file:\/\/\/catalog\/pods\/.+-draft\.yaml$/));
  view.rerender(editors(false, true));
  expect(screen.getByTestId('editor').getAttribute('data-path')).toBe(paths[1]);
});

describe('CodeEditor diff models', () => {
  it('uses distinct schema-associated paths in the supplied directory', () => {
    render(<CodeEditor filename="draft.yaml" path="file:///catalog/pods/draft.yaml" language="yaml" value="modified" original="original" diff />);
    const diff = screen.getByTestId('diff');
    const original = diff.getAttribute('data-original');
    const modified = diff.getAttribute('data-modified');
    expect(original).toMatch(/^file:\/\/\/catalog\/pods\/original-.*-draft\.yaml$/);
    expect(modified).toMatch(/^file:\/\/\/catalog\/pods\/modified-.*-draft\.yaml$/);
    expect(original).not.toBe(modified);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveTextAs } from './fileTransfer';

afterEach(() => vi.unstubAllGlobals());

describe('saveTextAs', () => {
  it('writes through the browser save picker and returns the name the user chose', async () => {
    const write = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const showSaveFilePicker = vi.fn(async () => ({ name: 'plant-a.pnid.json', createWritable: async () => ({ write, close }) }));
    vi.stubGlobal('window', { showSaveFilePicker });

    const saved = await saveTextAs('untitled.pnid.json', '{"x":1}');

    expect(saved).toBe('plant-a.pnid.json');
    expect(showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'untitled.pnid.json' }));
    expect(write).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('returns null, without writing, when the dialog is closed', async () => {
    const showSaveFilePicker = vi.fn(async () => {
      throw new DOMException('closed', 'AbortError');
    });
    vi.stubGlobal('window', { showSaveFilePicker });
    expect(await saveTextAs('a.pnid.json', 'x')).toBeNull();
  });

  it('lets a real write failure through', async () => {
    const showSaveFilePicker = vi.fn(async () => {
      throw new DOMException('disk full', 'NotAllowedError');
    });
    vi.stubGlobal('window', { showSaveFilePicker });
    await expect(saveTextAs('a.pnid.json', 'x')).rejects.toThrow('disk full');
  });

  it('without a picker, asks for a name and returns null if the prompt is cancelled', async () => {
    vi.stubGlobal('window', { prompt: vi.fn(() => null) });
    expect(await saveTextAs('a.pnid.json', 'x')).toBeNull();
  });
});

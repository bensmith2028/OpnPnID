import { describe, expect, it } from 'vitest';
import type { AttributeDefinition } from './db';
import { csvTemplateHeaders, mapCsvRow, parseCsv, rowToCsvLine } from './csv';

const valveAttributes: AttributeDefinition[] = [
  { id: 'a1', categoryId: 'valve', key: 'cv', label: 'Cv', type: 'number', unit: null, options: null, required: false, sortOrder: 0 },
  { id: 'a2', categoryId: 'valve', key: 'fail_position', label: 'Fail Position', type: 'select', unit: null, options: ['FC', 'FO'], required: false, sortOrder: 1 },
  { id: 'a3', categoryId: 'valve', key: 'has_positioner', label: 'Has Positioner', type: 'boolean', unit: null, options: null, required: false, sortOrder: 2 },
];

describe('csvTemplateHeaders', () => {
  it('puts the common columns first, then one per attribute key', () => {
    const headers = csvTemplateHeaders(valveAttributes);
    expect(headers.slice(0, 7)).toEqual(['manufacturer', 'model_number', 'description', 'price', 'currency', 'datasheet_url', 'image_url']);
    expect(headers.slice(7)).toEqual(['cv', 'fail_position', 'has_positioner']);
  });
});

describe('parseCsv', () => {
  it('parses a simple unquoted CSV', () => {
    const rows = parseCsv('a,b,c\n1,2,3\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields containing commas and escaped quotes', () => {
    const rows = parseCsv('name,note\n"Acme, Inc.","says ""hi"""\n');
    expect(rows).toEqual([
      ['name', 'note'],
      ['Acme, Inc.', 'says "hi"'],
    ]);
  });

  it('handles CRLF and a final line with no trailing newline', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n3,4');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('round-trips through rowToCsvLine for values needing escaping', () => {
    const line = rowToCsvLine(['Acme, Inc.', 'says "hi"', null, 42]);
    const [parsed] = parseCsv(line);
    expect(parsed).toEqual(['Acme, Inc.', 'says "hi"', '', '42']);
  });
});

describe('mapCsvRow', () => {
  const headers = ['manufacturer', 'model_number', 'description', 'price', 'currency', 'datasheet_url', 'image_url', 'cv', 'fail_position', 'has_positioner'];

  it('maps a well-formed row into real-part fields, coercing types by attribute definition', () => {
    const cells = ['Swagelok', 'SS-83XS6', 'Ball valve', '245.50', 'USD', 'https://example.com/ds.pdf', '', '2.5', 'FC', 'true'];
    const result = mapCsvRow(headers, cells, valveAttributes);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.manufacturer).toBe('Swagelok');
    expect(result.modelNumber).toBe('SS-83XS6');
    expect(result.price).toBe(245.5);
    expect(result.specs).toEqual({ cv: 2.5, fail_position: 'FC', has_positioner: true });
  });

  it('rejects a row missing manufacturer or model_number', () => {
    const cells = ['', 'SS-83XS6', '', '', '', '', '', '', '', ''];
    const result = mapCsvRow(headers, cells, valveAttributes);
    expect('error' in result).toBe(true);
  });

  it('drops an individual malformed numeric attribute instead of failing the whole row', () => {
    const cells = ['Swagelok', 'SS-83XS6', '', '', '', '', '', 'not-a-number', '', ''];
    const result = mapCsvRow(headers, cells, valveAttributes);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.specs).toEqual({});
  });

  it('leaves unset optional fields as null, not empty strings', () => {
    const cells = ['Swagelok', 'SS-83XS6', '', '', '', '', '', '', '', ''];
    const result = mapCsvRow(headers, cells, valveAttributes);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.description).toBeNull();
    expect(result.price).toBeNull();
    expect(result.datasheetUrl).toBeNull();
  });
});

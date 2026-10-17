import { expect, it } from 'vitest';
import { z } from 'zod';
import { HttpError, parse } from './http.js';

it('names invalid listing fields without echoing entered values', () => {
  try {
    parse(z.object({ description: z.string().min(10), recordCount: z.number().int().nonnegative() }), { description: 'private', recordCount: null });
    throw new Error('Expected validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(400);
    expect((error as Error).message).toContain('Description:');
    expect((error as Error).message).toContain('Records:');
    expect((error as Error).message).not.toContain('private');
    expect((error as HttpError).details).toHaveProperty('fieldErrors');
  }
});

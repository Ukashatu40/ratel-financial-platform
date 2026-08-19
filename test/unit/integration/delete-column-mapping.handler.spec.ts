// test/unit/integration/delete-column-mapping.handler.spec.ts
import { DeleteColumnMappingHandler } from '../../../src/integration/application/column-mapping/column-mapping.handlers';
import { DeleteColumnMappingCommand } from '../../../src/integration/application/column-mapping/column-mapping.commands';
import { EntityNotFoundError } from '../../../src/shared-kernel/errors/domain-error';
import { describe, expect, it } from '@jest/globals';

function buildHandler(deletedCount: number) {
  const deleteMany = jest.fn().mockResolvedValue({ count: deletedCount });
  const prisma = { columnMapping: { deleteMany } };
  return { handler: new DeleteColumnMappingHandler(prisma as any), deleteMany };
}

describe('DeleteColumnMappingHandler', () => {
  it('deletes the mapping when it exists in the caller\'s organization', async () => {
    const { handler, deleteMany } = buildHandler(1);

    await handler.execute(new DeleteColumnMappingCommand('org-1', 'mapping-1'));

    expect(deleteMany).toHaveBeenCalledTimes(1);
  });

  it('scopes the delete by organizationId in the SAME statement as the id', async () => {
    // Not a stylistic preference: a two-step "fetch then delete" leaves a
    // window where the ownership check and the delete disagree, and scoping
    // by id alone would let one organization delete another's mapping.
    const { handler, deleteMany } = buildHandler(1);

    await handler.execute(new DeleteColumnMappingCommand('org-1', 'mapping-1'));

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 'mapping-1', organizationId: 'org-1' },
    });
  });

  it('throws EntityNotFoundError when nothing matched', async () => {
    // count === 0 covers BOTH "no such mapping" and "belongs to another
    // organization" — deliberately indistinguishable, so this endpoint can't
    // be used to probe which IDs exist elsewhere.
    const { handler } = buildHandler(0);

    await expect(
      handler.execute(new DeleteColumnMappingCommand('org-1', 'someone-elses-mapping')),
    ).rejects.toThrow(EntityNotFoundError);
  });
});

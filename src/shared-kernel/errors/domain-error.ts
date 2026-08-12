// src/shared-kernel/errors/domain-error.ts
/**
 * Base for every domain/application-layer error. Carries a stable `code`
 * (maps 1:1 to an RFC 7807 `type` URL, Phase 7.6) and a default HTTP
 * status, so domain code never imports anything HTTP-related itself —
 * preserves the hexagonal dependency rule from Phase 4.3.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class PeriodClosedError extends DomainError {
  readonly code = 'period-closed';
  readonly httpStatus = 409;

  constructor(periodId: string) {
    super(`Financial period ${periodId} is closed. Submit an adjustment instead.`);
  }
}

export class EntityNotFoundError extends DomainError {
  readonly code = 'not-found';
  readonly httpStatus = 404;

  constructor(entityType: string, id: string) {
    super(`${entityType} with id ${id} was not found`);
  }
}

export class InvalidStateTransitionError extends DomainError {
  readonly code = 'invalid-state-transition';
  readonly httpStatus = 409;

  constructor(entityType: string, from: string, to: string) {
    super(`Cannot transition ${entityType} from '${from}' to '${to}'`);
  }
}

export class NoOpenPeriodError extends DomainError {
  readonly code = 'no-open-period';
  readonly httpStatus = 409;

  constructor(organizationId: string) {
    super(`Organization ${organizationId} has no currently open financial period`);
  }
}

export class ApproverRoleMismatchError extends DomainError {
  readonly code = 'approver-role-mismatch';
  readonly httpStatus = 403;

  constructor(approverId: string, requiredRole: string) {
    super(
      `Approver ${approverId} does not hold the required role '${requiredRole}' for this approval step`,
    );
  }
}

export class AttachmentNotSafeToDownloadError extends DomainError {
  readonly code = 'attachment-not-safe';
  readonly httpStatus = 409;

  constructor(scanStatus: string) {
    super(
      scanStatus === 'infected'
        ? 'This file was flagged as infected and cannot be downloaded'
        : 'This file has not finished virus scanning yet — try again in a moment',
    );
  }
}

export class InactiveOrMissingReferenceDataError extends DomainError {
  readonly code = 'inactive-or-missing-reference-data';
  readonly httpStatus = 400;

  constructor(entityType: string, id: string) {
    super(`${entityType} "${id}" does not exist or is no longer active`);
  }
}

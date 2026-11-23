/** Never report a terminated Modal job without a trusted cleanup acknowledgment. */
export class JobCancelledConfirmed extends Error {
  constructor(){super('Modal termination confirmed or no Sandbox started');this.name='JobCancelledConfirmed';}
}
export class JobCancellationUnconfirmed extends Error {
  constructor(){super('Cancellation requested but Modal termination not confirmed');this.name='JobCancellationUnconfirmed';}
}

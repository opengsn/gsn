declare module '@openzeppelin/test-helpers' {
  export function ether (value: string): BN

  export const expectEvent: any
  export const expectRevert: any
  export const time: any
  export const balance: any
  export const constants: any
  export const send: any
}

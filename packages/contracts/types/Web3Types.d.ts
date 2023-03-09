/* tslint:disable */

/* eslint-disable */

export interface EventData {
  returnValues: {
    [key: string]: any;
  };
  raw: {
    data: string;
    topics: string[];
  };
  event: string;
  signature: string;
  logIndex: number;
  transactionIndex: number;
  transactionHash: string;
  blockHash: string;
  blockNumber: number;
  address: string;
}

export type BlockNumber = string | number | BN /*| BigNumber*/ | 'latest' | 'pending' | 'earliest' | 'genesis';

export interface LogsOptions {
  fromBlock?: BlockNumber;
  address?: string | string[];
  topics?: Array<string | string[] | null>;
}

export interface PastLogsOptions extends LogsOptions {
  toBlock?: BlockNumber;
}

export interface Filter {
  [key: string]: number | string | string[] | number[];
}

export interface EventOptions extends LogsOptions {
  filter?: Filter;
}

export interface PastEventOptions extends PastLogsOptions {
  filter?: Filter;
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { delay } from "@azure/core-http";
import { Poller, PollOperation, PollOperationState } from "@azure/core-lro";
import { CopyModelOptions, GetCopyModelResultOptions } from "../../formTrainingClient";

import {
  GeneratedClientGetCustomModelCopyResultResponse as GetCustomModelCopyResultResponse,
  GeneratedClientCopyCustomModelResponse as CopyCustomModelResponseModel,
  OperationStatus
} from "../../generated/models";
import { CopyAuthorization, CustomFormModelInfo } from "../../models";
export { OperationStatus };

export interface CopyPollerOperationOptions {
  /**
   * Time between each polling in milliseconds.
   */
  updateIntervalInMs?: number;
  /**
   * callback to receive events on the progress of download operation.
   */
  onProgress?: (state: BeginCopyModelPollState) => void;
  /**
   * A serialized poller, used to resume an existing operation
   */
  resumeFrom?: string;
}

/**
 * Defines the operations from a training client that are needed for the poller
 * to work
 */
export type CopyModelPollerClient = {
  // returns a result id to retrieve results
  beginCopyModel: (
    modelId: string,
    copyAuthorization: CopyAuthorization,
    copyModelOptions?: CopyModelOptions
  ) => Promise<CopyCustomModelResponseModel>;
  // retrieves copy model result
  getCopyModelResult: (
    modelId: string,
    resultId: string,
    options: GetCopyModelResultOptions
  ) => Promise<GetCustomModelCopyResultResponse>;
};

/**
 * The state used by the poller returned from {@link FormTrainingClient.beginCopyModel}.
 *
 * This state is passed into the user-specified `onProgress` callback
 * whenever copy progress is detected.
 */
export interface BeginCopyModelPollState extends PollOperationState<CustomFormModelInfo> {
  /**
   * The instance of {@link CopyModelPollerClient} that is used when calling {@link FormTrainingClient.beginCopyModel}.
   */
  readonly client: CopyModelPollerClient;
  /**
   * Id of the model being copied
   */
  modelId: string;
  /**
   * Id of the target Form Recognizer resource
   */
  targetResourceId: string;
  /**
   * Region of the target Form Recognizer resource
   */
  targetResourceRegion: string;
  /**
   * The copy authorization generated by the target Form Recognizer resource.
   */
  copyAuthorization: CopyAuthorization;
  /**
   * Id of the copy model operation result.
   */
  resultId?: string;
  /**
   * Status of the copy model operation.
   */
  status: OperationStatus;
  /**
   * Option to the copy model operation.
   */
  readonly copyModelOptions?: CopyModelOptions;
}

export interface BeginCopyModelPollerOperation
  extends PollOperation<BeginCopyModelPollState, CustomFormModelInfo> {}

/**
 * @internal
 */
export type BeginCopyModelPollerOptions = {
  client: CopyModelPollerClient;
  modelId: string;
  targetResourceId: string;
  targetResourceRegion: string;
  copyAuthorization: CopyAuthorization;
  updateIntervalInMs?: number;
  resultId?: string;
  onProgress?: (state: BeginCopyModelPollState) => void;
  resumeFrom?: string;
} & CopyModelOptions;

/**
 * Class that represents a poller that waits until a model has been trained.
 */
export class BeginCopyModelPoller extends Poller<BeginCopyModelPollState, CustomFormModelInfo> {
  public updateIntervalInMs: number;

  constructor(options: BeginCopyModelPollerOptions) {
    const {
      client,
      updateIntervalInMs = 5000,
      modelId,
      resultId,
      targetResourceId,
      targetResourceRegion,
      copyAuthorization,
      onProgress,
      resumeFrom
    } = options;

    let state: BeginCopyModelPollState | undefined;

    if (resumeFrom) {
      state = JSON.parse(resumeFrom).state;
    }

    const operation = makeBeginCopyModelPollOperation({
      ...state,
      client,
      modelId,
      targetResourceId,
      targetResourceRegion,
      copyAuthorization,
      resultId,
      status: "notStarted",
      copyModelOptions: options
    });

    super(operation);

    if (typeof onProgress === "function") {
      this.onProgress(onProgress);
    }

    this.updateIntervalInMs = updateIntervalInMs;
  }

  public delay(): Promise<void> {
    return delay(this.updateIntervalInMs);
  }
}
/**
 * Creates a poll operation given the provided state.
 * @ignore
 */
function makeBeginCopyModelPollOperation(
  state: BeginCopyModelPollState
): BeginCopyModelPollerOperation {
  return {
    state: { ...state },

    async cancel(_options = {}): Promise<BeginCopyModelPollerOperation> {
      throw new Error("Cancel operation is not supported.");
    },

    async update(options = {}): Promise<BeginCopyModelPollerOperation> {
      const pollerState = this.state;
      const { client, modelId, copyAuthorization, copyModelOptions } = pollerState;

      if (!pollerState.isStarted) {
        pollerState.isStarted = true;
        const result = await client.beginCopyModel(
          modelId,
          copyAuthorization,
          copyModelOptions || {}
        );
        if (!result.operationLocation) {
          throw new Error("Expect a valid 'operationLocation' to retrieve analyze results");
        }
        const lastSlashIndex = result.operationLocation.lastIndexOf("/");
        pollerState.resultId = result.operationLocation.substring(lastSlashIndex + 1);
      }

      const response = await client.getCopyModelResult(modelId, pollerState.resultId!, {
        abortSignal: copyModelOptions?.abortSignal
      });

      pollerState.status = response.status;
      if (!pollerState.isCompleted) {
        if (
          (response.status === "running" || response.status === "notStarted") &&
          typeof options.fireProgress === "function"
        ) {
          options.fireProgress(pollerState);
        } else if (response.status === "succeeded") {
          pollerState.result = {
            status: "ready",
            trainingStartedOn: response.createdOn,
            trainingCompletedOn: response.lastModified,
            modelId: copyAuthorization.modelId
          };
          pollerState.isCompleted = true;
        } else if (response.status === "failed") {
          throw new Error(`Copy model operation failed: ${response._response.bodyAsText}`);
        }
      }

      return makeBeginCopyModelPollOperation(pollerState);
    },

    toString() {
      return JSON.stringify({ state: this.state }, (key, value) => {
        if (key === "client" || key === "source") {
          return undefined;
        }
        return value;
      });
    }
  };
}

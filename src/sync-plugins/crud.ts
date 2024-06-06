import { getNodeValue, internal, isNullOrUndefined } from '@legendapp/state';
import { SyncedGetParams, SyncedOptions, SyncedSetParams, deepEqual, diffObjects, synced } from '@legendapp/state/sync';

const { clone } = internal;

export type CrudAsOption = 'Map' | 'object' | 'value' | 'array';

export type CrudResult<T> = T;

export interface SyncedCrudPropsSingle<TRemote, TLocal> {
    get?: (params: SyncedGetParams) => Promise<CrudResult<TRemote | null>> | CrudResult<TRemote | null>;
    initial?: InitialValue<TLocal, 'value'>;
    as?: never | 'value';
}
export interface SyncedCrudPropsMany<TRemote, TLocal, TAsOption extends CrudAsOption> {
    list?: (params: SyncedGetParams) => Promise<CrudResult<TRemote[] | null>> | CrudResult<TRemote[] | null>;
    as?: TAsOption;
    initial?: InitialValue<TLocal, TAsOption>;
}
export interface SyncedCrudOnSavedParams<TRemote extends { id: string | number }, TLocal> {
    saved: TLocal;
    input: TRemote;
    currentValue: TLocal;
    isCreate: boolean;
    props: SyncedCrudPropsBase<TRemote, TLocal>;
}
export interface SyncedCrudPropsBase<TRemote extends { id: string | number }, TLocal = TRemote>
    extends Omit<SyncedOptions<TRemote, TLocal>, 'get' | 'set' | 'initial'> {
    create?(input: TRemote, params: SyncedSetParams<TRemote>): Promise<CrudResult<TRemote> | null | undefined>;
    update?(
        input: Partial<TRemote>,
        params: SyncedSetParams<TRemote>,
    ): Promise<CrudResult<Partial<TRemote> | null | undefined>>;
    delete?(input: { id: TRemote['id'] }, params: SyncedSetParams<TRemote>): Promise<CrudResult<any>>;
    onSaved?(params: SyncedCrudOnSavedParams<TRemote, TLocal>): Partial<TLocal> | void;
    fieldUpdatedAt?: string;
    fieldCreatedAt?: string;
    fieldDeleted?: string;
    updatePartial?: boolean;
    changesSince?: 'all' | 'last-sync';
    generateId?: () => string | number;
}

type InitialValue<TLocal, TAsOption extends CrudAsOption> = TAsOption extends 'Map'
    ? Map<string | number, TLocal>
    : TAsOption extends 'object'
      ? Record<string | number, TLocal>
      : TAsOption extends 'value'
        ? TLocal
        : TLocal[];

export type SyncedCrudReturnType<TLocal, TAsOption extends CrudAsOption> = TAsOption extends 'Map'
    ? Map<TLocal extends { id: number } ? number : string, TLocal>
    : TAsOption extends 'object'
      ? Record<TLocal extends { id: number } ? number : string, TLocal>
      : TAsOption extends 'value'
        ? TLocal
        : TLocal[];

let _asOption: CrudAsOption;

function transformOut<T1, T2>(data: T1, transform: undefined | ((value: T1) => T2)) {
    return transform ? transform(clone(data)) : data;
}

function ensureId(obj: { id: string | number }, generateId: () => string | number) {
    if (!obj.id) {
        obj.id = generateId();
    }
    return obj.id;
}

export function syncedCrud<TRemote extends { id: string | number }, TLocal = TRemote>(
    props: SyncedCrudPropsBase<TRemote, TLocal> & SyncedCrudPropsSingle<TRemote, TLocal>,
): SyncedCrudReturnType<TLocal, 'value'>;
export function syncedCrud<
    TRemote extends { id: string | number },
    TLocal = TRemote,
    TAsOption extends CrudAsOption = 'object',
>(
    props: SyncedCrudPropsBase<TRemote, TLocal> & SyncedCrudPropsMany<TRemote, TLocal, TAsOption>,
): SyncedCrudReturnType<TLocal, Exclude<TAsOption, 'value'>>;
export function syncedCrud<
    TRemote extends { id: string | number },
    TLocal = TRemote,
    TAsOption extends CrudAsOption = 'object',
>(
    props: SyncedCrudPropsBase<TRemote, TLocal> &
        (SyncedCrudPropsSingle<TRemote, TLocal> & SyncedCrudPropsMany<TRemote, TLocal, TAsOption>),
): SyncedCrudReturnType<TLocal, TAsOption> {
    const {
        get: getFn,
        list: listFn,
        create: createFn,
        update: updateFn,
        delete: deleteFn,
        transform,
        fieldCreatedAt,
        fieldUpdatedAt,
        fieldDeleted,
        updatePartial,
        onSaved,
        mode: modeParam,
        changesSince,
        generateId,
        ...rest
    } = props;

    let asType = props.as as TAsOption;

    if (!asType) {
        asType = (getFn ? 'value' : _asOption || 'object') as CrudAsOption as TAsOption;
    }

    const asMap = asType === 'Map';
    const asArray = asType === 'array';

    const get: undefined | ((params: SyncedGetParams) => Promise<TLocal>) =
        getFn || listFn
            ? async (getParams: SyncedGetParams) => {
                  const { updateLastSync, lastSync, value } = getParams;
                  if (listFn) {
                      const isLastSyncMode = changesSince === 'last-sync';
                      if (isLastSyncMode && lastSync) {
                          getParams.mode =
                              modeParam || (asType === 'array' ? 'append' : asType === 'value' ? 'set' : 'assign');
                      }

                      const data = (await listFn(getParams)) || [];
                      let newLastSync = 0;
                      for (let i = 0; i < data.length; i++) {
                          const updated =
                              (data[i] as any)[fieldUpdatedAt as any] || (data[i] as any)[fieldCreatedAt as any];
                          if (updated) {
                              newLastSync = Math.max(newLastSync, +new Date(updated));
                          }
                      }
                      if (newLastSync && newLastSync !== lastSync) {
                          updateLastSync(newLastSync);
                      }
                      let transformed = data as unknown as TLocal[];
                      if (transform?.load) {
                          transformed = await Promise.all(data.map((value) => transform.load!(value, 'get')));
                      }
                      if (asType === 'value') {
                          return transformed.length > 0
                              ? transformed[0]
                              : (isLastSyncMode && lastSync && value) || null;
                      } else {
                          const results = transformed.map((result: any) =>
                              result[fieldDeleted as any] || result.__deleted ? internal.symbolDelete : result,
                          );
                          const out = asType === 'array' ? [] : asMap ? new Map() : {};
                          for (let i = 0; i < results.length; i++) {
                              let result = results[i];
                              result = result[fieldDeleted as any] || result.__deleted ? internal.symbolDelete : result;
                              if (asArray) {
                                  (out as any[]).push(result);
                              } else if (asMap) {
                                  (out as Map<string, any>).set(result.id, result);
                              } else {
                                  (out as Record<string, any>)[result.id] = result;
                              }
                          }
                          return out;
                      }
                  } else if (getFn) {
                      const data = await getFn(getParams);

                      let transformed = data as unknown as TLocal;
                      if (data) {
                          const newLastSync =
                              (data as any)[fieldUpdatedAt as any] || (data as any)[fieldCreatedAt as any];
                          if (newLastSync && newLastSync !== lastSync) {
                              updateLastSync(newLastSync);
                          }
                          if (transform?.load) {
                              transformed = await transform.load(data, 'get');
                          }
                      }

                      return transformed as any;
                  }
              }
            : undefined;

    const set =
        createFn || updateFn || deleteFn
            ? async (params: SyncedSetParams<any> & { retryAsCreate?: boolean }) => {
                  const { value, changes, update, retryAsCreate, valuePrevious, node } = params;
                  const creates = new Map<string, TLocal>();
                  const updates = new Map<string, object>();
                  const deletes = new Set<string>();

                  changes.forEach(({ path, prevAtPath, valueAtPath }) => {
                      if (asType === 'value') {
                          if (value) {
                              let id = value?.id;
                              const isCreate = fieldCreatedAt ? !value[fieldCreatedAt!] : !prevAtPath;
                              if (!id && generateId) {
                                  id = ensureId(value, generateId);
                              }
                              if (id) {
                                  if (isCreate || retryAsCreate) {
                                      creates.set(id, value);
                                  } else if (path.length === 0) {
                                      if (valueAtPath) {
                                          updates.set(id, valueAtPath);
                                      } else if (prevAtPath) {
                                          deletes.add(prevAtPath?.id);
                                      }
                                  } else {
                                      updates.set(id, Object.assign(updates.get(id) || { id }, value));
                                  }
                              } else {
                                  console.error('[legend-state]: added synced item without an id');
                              }
                          } else if (path.length === 0) {
                              const id = prevAtPath?.id;
                              if (id) {
                                  deletes.add(id);
                              }
                          }
                      } else {
                          let itemsChanged: [string, any][] | undefined = undefined;
                          if (path.length === 0) {
                              // Do a deep equal of each element vs its previous element to see which have changed
                              itemsChanged = (
                                  asMap
                                      ? Array.from((valueAtPath as Map<any, any>).entries())
                                      : Object.entries(valueAtPath)
                              ).filter(([key, value]) => {
                                  const prev = asMap ? prevAtPath.get(key) : prevAtPath[key];
                                  const isDiff = !prevAtPath || !deepEqual(value, prev);

                                  return isDiff;
                              });
                          } else {
                              const itemKey = path[0];
                              const itemValue = asMap ? value.get(itemKey) : value[itemKey];
                              if (!itemValue) {
                                  if (path.length === 1 && prevAtPath) {
                                      deletes.add(itemKey);
                                  }
                              } else {
                                  itemsChanged = [[itemKey, itemValue]];
                              }
                          }
                          itemsChanged?.forEach(([itemKey, item]) => {
                              if (isNullOrUndefined(item)) {
                                  deletes.add(itemKey);
                              } else {
                                  const prev = asMap ? valuePrevious.get(itemKey) : valuePrevious[itemKey];

                                  const isCreate = fieldCreatedAt
                                      ? !item[fieldCreatedAt!]
                                      : fieldUpdatedAt
                                        ? !item[fieldUpdatedAt]
                                        : isNullOrUndefined(prev);
                                  if (isCreate) {
                                      if (generateId) {
                                          ensureId(item, generateId);
                                      }
                                      if (!item.id) {
                                          console.error('[legend-state]: added item without an id');
                                      }
                                      if (createFn) {
                                          creates.set(item.id, item);
                                      } else {
                                          console.log('[legend-state] missing create function');
                                      }
                                  } else {
                                      if (updateFn) {
                                          updates.set(item.id, item);
                                      } else {
                                          console.log('[legend-state] missing update function');
                                      }
                                  }
                              }
                          });
                      }
                  });

                  const saveResult = async (
                      itemKey: string,
                      input: TRemote,
                      data: CrudResult<TRemote>,
                      isCreate: boolean,
                  ) => {
                      if (data) {
                          const saved: TLocal = (transform?.load ? transform.load(data as any, 'set') : data) as any;

                          const isChild = itemKey !== 'undefined' && asType !== 'value';
                          const currentPeeked = getNodeValue(node);

                          const currentValue = isChild ? currentPeeked?.[itemKey] : currentPeeked;

                          const dataOnSaved: SyncedCrudOnSavedParams<TRemote, TLocal> = {
                              saved,
                              input,
                              currentValue,
                              isCreate,
                              props,
                          };
                          let savedOut: Partial<TLocal> | undefined = saved;

                          if (savedOut) {
                              // Remove keys from savedOut that have been modified locally since saving
                              savedOut = clone(savedOut) as TLocal;
                              Object.keys(savedOut).forEach((key) => {
                                  const i = (input as any)[key];
                                  const c = currentValue[key];
                                  if (
                                      // value is already the new value, can ignore
                                      (savedOut as any)[key] === c ||
                                      // user has changed local value
                                      (key !== 'id' && i !== c)
                                  ) {
                                      delete (savedOut as any)[key];
                                  }
                              });

                              if (onSaved) {
                                  const ret = onSaved(dataOnSaved);
                                  if (ret) {
                                      savedOut = ret;
                                  }
                              }
                              const createdAt = fieldCreatedAt ? savedOut[fieldCreatedAt as keyof TLocal] : undefined;
                              const updatedAt = fieldUpdatedAt ? savedOut[fieldUpdatedAt as keyof TLocal] : undefined;

                              const value =
                                  itemKey !== 'undefined' && asType !== 'value' ? { [itemKey]: savedOut } : savedOut;
                              update({
                                  value,
                                  lastSync:
                                      updatedAt || createdAt ? +new Date(updatedAt || (createdAt as any)) : undefined,
                                  mode: 'merge',
                              });
                          }
                      }
                  };

                  return Promise.all([
                      ...Array.from(creates).map(([itemKey, itemValue]) => {
                          const createObj = transformOut(itemValue, transform?.save) as TRemote;
                          return createFn!(createObj, params).then((result) =>
                              saveResult(itemKey, createObj, result as any, true),
                          );
                      }),
                      ...Array.from(updates).map(([itemKey, itemValue]) => {
                          const toSave = updatePartial
                              ? Object.assign(
                                    diffObjects(asType === 'value' ? valuePrevious : valuePrevious[itemKey], itemValue),
                                    { id: (itemValue as any).id },
                                )
                              : itemValue;
                          const changed = transformOut(toSave as TLocal, transform?.save) as TRemote;

                          if (Object.keys(changed).length > 0) {
                              return updateFn!(changed, params).then(
                                  (result) => result && saveResult(itemKey, changed, result as any, false),
                              );
                          }
                      }),
                      ...Array.from(deletes).map((id) => {
                          if (deleteFn) {
                              deleteFn({ id }, params);
                          } else if (fieldDeleted && updateFn) {
                              updateFn({ id, [fieldDeleted]: true } as any, params);
                          } else {
                              console.log('[legend-state] missing delete function');
                          }
                      }),
                  ]);
              }
            : undefined;

    return synced<any>({
        set,
        get,
        mode: modeParam,
        ...rest,
    });
}

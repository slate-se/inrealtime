import { RealtimeConfig } from '../../../../config'
import { clone, Fragment, FragmentList, FragmentMap, FragmentType } from '../../../../core'
import {
  addFragmentIdToPath,
  FragmentIdToPath,
  FragmentPath,
  ImmerPath,
  ImmutablePaths,
  removeFragmentIdToPath,
} from './pathUtils'

type InsertFragment = {
  insertedFragment: Fragment
  insertedIndex: string | number
  parentFragment: Fragment
  parentFragmentPath: FragmentPath
}

type DeleteFragment = {
  removedFragment: Fragment
  removedIndex: string | number
  parentFragment: Fragment
  parentFragmentPath: FragmentPath
}

type MoveFragment = {
  movedFragment: Fragment
  listFragmentPath: FragmentPath
  fromIndex: number
  toIndex: number
}

export const createImmutableFragment = (
  fragment: Fragment,
  fragmentIdToPath: FragmentIdToPath,
  config?: RealtimeConfig,
): IImmutableFragment => {
  return new ImmutableFragment(fragment, fragmentIdToPath, config)
}

export interface IImmutableFragment {
  getFragment(): Fragment
  getFragmentIdToPath(): FragmentIdToPath
  insertAtImmerPath({}: {
    insertedFragment: Fragment
    parentImmerPath: ImmerPath
    index: string | number
  }): InsertFragment
  insertWithFragmentId({}: {
    insertedFragment: Fragment
    parentFragmentId: string
  }): InsertFragment | undefined
  deleteAtImmerPath({}: { immerPath: ImmerPath }): DeleteFragment
  deleteWithFragmentId({}: { fragmentId: string }): DeleteFragment | undefined
  moveIndexAtImmerPath({}: {
    listImmerPath: ImmerPath
    fromIndex: number
    toIndex: number
  }): MoveFragment
  moveIndexWithFragmentId({}: { fragmentId: string; toIndex: number }): MoveFragment | undefined
  getSubDocumentFromFragmentPath(document: any, path: FragmentPath): any
  replaceFragment({}: {
    oldFragment: Fragment
    newFragment: Fragment
    newFragmentPath: FragmentPath
    parentId: string
  }): { parentFragment: Fragment }
}

export class ImmutableFragment implements IImmutableFragment {
  _fragment: Fragment
  _fragmentIdToPath: FragmentIdToPath
  readonly _immutablePaths: ImmutablePaths
  readonly _config?: RealtimeConfig

  constructor(fragment: Fragment, fragmentIdToPath: FragmentIdToPath, config?: RealtimeConfig) {
    this._fragment = fragment
    this._fragmentIdToPath = fragmentIdToPath
    this._immutablePaths = {}
    this._config = config
  }

  getFragment(): Fragment {
    return this._fragment
  }

  getFragmentIdToPath(): FragmentIdToPath {
    return this._fragmentIdToPath
  }

  /**
   * Generate a string from a path
   */
  _createImmutablePath(path: FragmentPath): string {
    // We create a new string which escapes all dots in each path item, then joins the path by dots.
    return path.map((p) => `${p}`.replace(/\./g, '\\.')).join('.')
  }

  /**
   * Combine two immutable paths
   */
  _combineImmutablePaths(path1: string, path2: string): string {
    return `${path1}.${path2}`
  }

  /**
   * Check if path has been made immutable
   */
  _isPathImmutable(path: string): boolean {
    return !!this._immutablePaths[path]
  }

  /**
   * Add immutable path
   */
  _addImmutablePath(path: string): void {
    this._immutablePaths[path] = true
  }

  /**
   * Remove immutable path
   */
  _removeImmutablePath(path: string): void {
    delete this._immutablePaths[path]
  }

  /**
   * Get fragment path from immer path
   */
  _getFragmentPathFromImmerPath(immerPath: ImmerPath): FragmentPath {
    const fragmentPath: FragmentPath = []
    let subFragment = this._fragment
    for (let i = 0; i < immerPath.length; ++i) {
      let subPath: string
      if (subFragment.type === FragmentType.List) {
        const listIndex = immerPath[i] as number
        const subSubFragment = Object.values(subFragment.value).find(
          (f) => f.parentListIndex === listIndex,
        )

        if (this._config?.logging.listFragmentIndexes) {
          if (!subSubFragment) {
            console.warn(
              `Could not find sub fragment with list index '${listIndex}'`,
              immerPath,
              listIndex,
              clone(subFragment.value),
            )
          }
          debugListFragmentIndexes(subFragment, '_getFragmentPathFromImmerPath')
        }
        subPath = subSubFragment!.id
      } else {
        subPath = immerPath[i] as string
      }
      subFragment = (subFragment as FragmentMap | FragmentList).value[subPath]
      fragmentPath.push(subPath)
    }
    return fragmentPath
  }

  /**
   * Get an immutable sub fragment based on a fragment path
   */
  _getFragmentFromFragmentPath({ path }: { path: FragmentPath }): {
    fragment: Fragment
    immutablePath: string
  } {
    let fragment = this._fragment
    let immutablePath = ''
    if (!this._isPathImmutable(immutablePath)) {
      this._addImmutablePath(immutablePath)
      fragment = { ...fragment } as any

      if ((fragment as FragmentMap | FragmentList).value) {
        ;(fragment as FragmentMap | FragmentList).value = {
          ...(fragment as FragmentMap | FragmentList).value,
        }
      }
    }

    let subFragment = fragment

    for (let i = 0; i < path.length; ++i) {
      if (subFragment === undefined) {
        break
      }

      const index = path[i]

      const immutableSubPath = this._createImmutablePath([index])
      immutablePath = immutablePath
        ? this._combineImmutablePaths(immutablePath, immutableSubPath)
        : immutableSubPath

      const listOrMap = subFragment as FragmentList | FragmentMap
      let nextSubFragment = listOrMap.value[index]
      if (!this._isPathImmutable(immutablePath)) {
        this._addImmutablePath(immutablePath)
        nextSubFragment = { ...nextSubFragment } as any
        if ((nextSubFragment as FragmentMap | FragmentList).value) {
          ;(nextSubFragment as FragmentMap | FragmentList).value = {
            ...(nextSubFragment as FragmentMap | FragmentList).value,
          }
        }
        listOrMap.value[index] = nextSubFragment
      }

      subFragment = nextSubFragment
    }

    // Update head fragment
    this._fragment = fragment

    return { fragment: subFragment, immutablePath }
  }

  /**
   * Get an immutable sub fragments list based on an immer path
   * Only make items which are within index [itemImmutabilityFromIndex, itemImmutabilityToIndex]
   */
  _getListFragments = ({
    listFragment,
    listImmutablePath,
    itemImmutabilityFromIndex,
    itemImmutabilityToIndex,
  }: {
    listFragment: FragmentList
    listImmutablePath: string
    itemImmutabilityFromIndex: number
    itemImmutabilityToIndex: number
  }): Fragment[] => {
    return Object.values(listFragment.value).map((f) => {
      const subImmutablePath = this._combineImmutablePaths(listImmutablePath, f.id)
      if (
        !this._isPathImmutable(subImmutablePath) &&
        f.parentListIndex! >= itemImmutabilityFromIndex &&
        f.parentListIndex! <= itemImmutabilityToIndex
      ) {
        this._addImmutablePath(subImmutablePath)
        f = { ...f } as any
        if ((f as FragmentList | FragmentMap).value) {
          ;(f as FragmentList | FragmentMap).value = { ...(f as FragmentList | FragmentMap).value }
        }
        listFragment.value[f.id] = f
      }
      return f
    })
  }

  /**
   * Get a fragment and a parent fragment from fragment id
   */
  _getFragmentAndParentFragment({ fragmentPath }: { fragmentPath: FragmentPath }): {
    fragment: Fragment
    fragmentImmutablePath: string
    parentFragment: Fragment
    parentFragmentPath: FragmentPath
    parentFragmentImmutablePath: string
  } {
    // Get moved fragment
    const { fragment, immutablePath: fragmentImmutablePath } = this._getFragmentFromFragmentPath({
      path: fragmentPath,
    })

    // Get parent fragment
    const parentFragmentPath = this._fragmentIdToPath[fragment.parentId!]

    const { fragment: parentFragment, immutablePath: parentFragmentImmutablePath } =
      this._getFragmentFromFragmentPath({
        path: parentFragmentPath,
      })

    return {
      fragment,
      fragmentImmutablePath,
      parentFragment,
      parentFragmentPath,
      parentFragmentImmutablePath,
    }
  }

  /**
   * Insert a fragment with an immer path
   */
  insertAtImmerPath({
    insertedFragment,
    parentImmerPath,
    index,
  }: {
    insertedFragment: Fragment
    parentImmerPath: ImmerPath
    index: string | number
  }): InsertFragment {
    const parentFragmentPath = this._getFragmentPathFromImmerPath(parentImmerPath)
    return this._insertFragment({ insertedFragment, parentFragmentPath, index })
  }

  /**
   * Insert a fragment inside a specific parent fragment id
   */
  insertWithFragmentId({
    insertedFragment,
    parentFragmentId,
  }: {
    insertedFragment: Fragment
    parentFragmentId: string
  }): InsertFragment | undefined {
    const parentFragmentPath = this._fragmentIdToPath[parentFragmentId]
    if (!parentFragmentPath) {
      return undefined
    }
    return this._insertFragment({ insertedFragment, parentFragmentPath })
  }

  /**
   * Insert a fragment at a fragment path
   */
  _insertFragment({
    insertedFragment,
    parentFragmentPath,
    index,
  }: {
    insertedFragment: Fragment
    parentFragmentPath: FragmentPath
    index?: string | number
  }): InsertFragment {
    // Get parent fragment
    const { fragment: parentFragment, immutablePath: parentFragmentImmutablePath } =
      this._getFragmentFromFragmentPath({
        path: parentFragmentPath,
      })

    const fragmentIndex: string =
      parentFragment.type === FragmentType.List
        ? insertedFragment.id
        : index
        ? (index as string)
        : insertedFragment.parentMapKey!

    const oldFragment = (parentFragment as FragmentMap | FragmentList).value[fragmentIndex]

    // If list we need to shift indexes
    let insertedIndex: string | number
    if (parentFragment.type === FragmentType.List) {
      if (index !== undefined) {
        insertedFragment.parentListIndex = index as number
      }
      if (oldFragment) {
        insertedFragment.parentListIndex = oldFragment.parentListIndex
      }

      // Get list items
      const listFragments = this._getListFragments({
        listFragment: parentFragment,
        listImmutablePath: parentFragmentImmutablePath,
        itemImmutabilityFromIndex: insertedFragment.parentListIndex!,
        itemImmutabilityToIndex: Number.MAX_SAFE_INTEGER,
      })

      // Shift list items to the right
      const toIndex = insertedFragment.parentListIndex!
      const addedIndex = toIndex >= listFragments.length ? listFragments.length : toIndex
      insertedFragment.parentListIndex = addedIndex

      // Debug that indexes are not correct
      if (this._config?.logging.listFragmentIndexes) {
        debugListFragmentIndexes(parentFragment, `About to insert at ${addedIndex}.`)
      }

      if (!oldFragment) {
        for (const fragment of listFragments) {
          if (fragment.parentListIndex! >= addedIndex) {
            fragment.parentListIndex!++
          }
        }
      }

      insertedIndex = addedIndex
    } else {
      if (index !== undefined) {
        insertedFragment.parentMapKey = index as string
      }

      insertedIndex = insertedFragment.parentMapKey!
    }

    // If replacing fragment
    if (oldFragment) {
      removeFragmentIdToPath({ fragment: oldFragment, fragmentIdToPath: this._fragmentIdToPath })
    }

    // Insert into fragment path
    const fragmentPath: FragmentPath = [...parentFragmentPath, fragmentIndex]
    addFragmentIdToPath({
      fragment: insertedFragment,
      fragmentIdToPath: this._fragmentIdToPath,
      path: fragmentPath,
    })

    // Add the fragment to immutable paths
    this._addImmutablePath(this._combineImmutablePaths(parentFragmentImmutablePath, fragmentIndex))

    // Insert into fragment parent
    insertedFragment.parentId = parentFragment.id
    ;(parentFragment as FragmentMap | FragmentList).value[fragmentIndex] = insertedFragment

    // Debug that indexes are not correct
    if (this._config?.logging.listFragmentIndexes && parentFragment.type === FragmentType.List) {
      debugListFragmentIndexes(
        parentFragment,
        `Inserted at ${insertedFragment.parentListIndex}. ${
          oldFragment
            ? `Replaced old fragment, its index was ${oldFragment.parentListIndex}`
            : 'Did not replace old fragment'
        }`,
      )
    }

    return { insertedFragment, insertedIndex, parentFragment, parentFragmentPath }
  }

  /**
   * Delete a fragment with an immer path
   */
  deleteAtImmerPath({ immerPath }: { immerPath: ImmerPath }): DeleteFragment {
    const fragmentPath = this._getFragmentPathFromImmerPath(immerPath)
    return this._deleteFragment({ fragmentPath })
  }

  /**
   * Delete a fragment with a specific fragment id
   */
  deleteWithFragmentId({ fragmentId }: { fragmentId: string }): DeleteFragment | undefined {
    const fragmentPath = this._fragmentIdToPath[fragmentId]
    if (!fragmentPath) {
      return undefined
    }
    return this._deleteFragment({ fragmentPath })
  }

  /**
   * Delete a fragment at a fragment path
   */
  _deleteFragment({ fragmentPath }: { fragmentPath: FragmentPath }): DeleteFragment {
    const fragmentParentResult = this._getFragmentAndParentFragment({ fragmentPath })

    const {
      fragment: removedFragment,
      fragmentImmutablePath,
      parentFragment,
      parentFragmentPath,
      parentFragmentImmutablePath,
    } = fragmentParentResult

    // Remove from fragment path
    removeFragmentIdToPath({
      fragment: removedFragment,
      fragmentIdToPath: this._fragmentIdToPath,
    })

    // Remove the fragment from immutable paths
    this._removeImmutablePath(fragmentImmutablePath)

    let removedIndex: string | number
    if (parentFragment.type === FragmentType.List) {
      // Debug that indexes are not correct
      if (this._config?.logging.listFragmentIndexes) {
        debugListFragmentIndexes(
          parentFragment,
          `About to delete fragment at index '${removedFragment.parentListIndex}'`,
        )
      }

      // Delete from parent fragment
      delete parentFragment.value[removedFragment.id]

      // Get list items
      const listFragments = this._getListFragments({
        listFragment: parentFragment,
        listImmutablePath: parentFragmentImmutablePath,
        itemImmutabilityFromIndex: removedFragment.parentListIndex! + 1,
        itemImmutabilityToIndex: Number.MAX_SAFE_INTEGER,
      })

      // Shift list items to the left
      removedIndex = removedFragment.parentListIndex!
      for (const fragment of listFragments) {
        if (fragment.parentListIndex! > removedIndex) {
          fragment.parentListIndex!--
        }
      }

      // Debug that indexes are not correct
      if (this._config?.logging.listFragmentIndexes) {
        debugListFragmentIndexes(parentFragment, `Deleted fragment at index '${removedIndex}'`)
      }
    } else {
      removedIndex = removedFragment.parentMapKey!

      // Delete from parent fragment
      delete (parentFragment as FragmentMap).value[removedFragment.parentMapKey!]
    }

    return { removedFragment, removedIndex, parentFragment, parentFragmentPath }
  }

  /**
   * Move an index of an item in a list fragment from an immer path
   */
  moveIndexAtImmerPath({
    listImmerPath,
    fromIndex,
    toIndex,
  }: {
    listImmerPath: ImmerPath
    fromIndex: number
    toIndex: number
  }): MoveFragment {
    const fragmentPath = this._getFragmentPathFromImmerPath([...listImmerPath, fromIndex])
    return this._moveFragment({ movedFragmentPath: fragmentPath, toIndex })
  }

  /**
   * Move an index in a list from fragment id
   */
  moveIndexWithFragmentId({
    fragmentId,
    toIndex,
  }: {
    fragmentId: string
    toIndex: number
  }): MoveFragment | undefined {
    const fragmentPath = this._fragmentIdToPath[fragmentId]
    if (!fragmentPath) {
      return undefined
    }
    return this._moveFragment({ movedFragmentPath: fragmentPath, toIndex })
  }

  /**
   * Move an index of an item with a fragment path
   */
  _moveFragment({
    movedFragmentPath,
    toIndex,
  }: {
    movedFragmentPath: FragmentPath
    toIndex: number
  }): MoveFragment {
    const fragmentParentResult = this._getFragmentAndParentFragment({
      fragmentPath: movedFragmentPath,
    })!
    const {
      fragment: movedFragment,
      parentFragment: listFragment,
      parentFragmentPath: listFragmentPath,
      parentFragmentImmutablePath: listImmutablePath,
    } = fragmentParentResult

    if (listFragment.type !== FragmentType.List) {
      throw new Error(
        `Parent of a moved item must be a ${FragmentType.List}, was ${listFragment.type}.`,
      )
    }

    // Get list items
    const fromIndex = movedFragment.parentListIndex!
    const listFragments = this._getListFragments({
      listFragment: listFragment,
      listImmutablePath: listImmutablePath,
      itemImmutabilityFromIndex: toIndex > fromIndex ? fromIndex : toIndex,
      itemImmutabilityToIndex: toIndex > fromIndex ? toIndex : fromIndex,
    })
    toIndex = toIndex >= listFragments.length ? listFragments.length - 1 : toIndex

    // Debug that indexes are not correct
    if (this._config?.logging.listFragmentIndexes) {
      debugListFragmentIndexes(
        listFragment,
        `About to move fragment from '${fromIndex}' to '${toIndex}'`,
      )
    }

    // If moving to the right, shift all keys which are between [fromIndex+1, toIndex] to the left
    if (fromIndex < toIndex) {
      for (const item of listFragments) {
        const listIndex = item.parentListIndex!

        if (listIndex > fromIndex && listIndex <= toIndex) {
          item.parentListIndex!--
        } else if (listIndex === fromIndex) {
          item.parentListIndex = toIndex
        }
      }
    }

    // If moving to the left, shift all keys which are between [toIndex, fromIndex-1] to the right
    if (fromIndex > toIndex) {
      for (const item of listFragments) {
        const listIndex = item.parentListIndex!

        if (listIndex >= toIndex && listIndex < fromIndex) {
          item.parentListIndex!++
        } else if (listIndex === fromIndex) {
          item.parentListIndex = toIndex
        }
      }
    }

    // Debug that indexes are not correct
    if (this._config?.logging.listFragmentIndexes) {
      debugListFragmentIndexes(listFragment, `Moved fragment from '${fromIndex}' to '${toIndex}'`)
    }

    return { movedFragment, listFragmentPath, fromIndex, toIndex }
  }

  /**
   * Replace a fragment with another
   */
  replaceFragment({
    oldFragment,
    newFragment,
    newFragmentPath,
    parentId,
  }: {
    oldFragment: Fragment
    newFragment: Fragment
    newFragmentPath: FragmentPath
    parentId: string
  }): { parentFragment: Fragment } {
    const parentFragmentPath = this._fragmentIdToPath[parentId!]
    const { fragment: parentFragment } = this._getFragmentFromFragmentPath({
      path: parentFragmentPath,
    })

    const fragmentIndex =
      parentFragment.type === FragmentType.List ? oldFragment.id : oldFragment.parentMapKey!

    // Remove from fragment path
    removeFragmentIdToPath({
      fragment: oldFragment,
      fragmentIdToPath: this._fragmentIdToPath,
    })

    // Insert into fragment path
    addFragmentIdToPath({
      fragment: newFragment,
      fragmentIdToPath: this._fragmentIdToPath,
      path: newFragmentPath,
    })

    // Replace fragment
    ;(parentFragment as FragmentMap | FragmentList).value[fragmentIndex] = newFragment

    // Note We should definitely not add to immutable paths. We want new fragment to be updated if its edited

    return { parentFragment }
  }
  /**
   * Get a sub document based on a fragment path
   */
  getSubDocumentFromFragmentPath(document: any, path: FragmentPath): any {
    let subDocument = document
    let subFragment = this._fragment
    for (let i = 0; i < path.length; ++i) {
      if (subFragment === undefined) {
        break
      }
      subFragment = (subFragment as FragmentMap).value[path[i]]
      subDocument =
        subDocument[
          subFragment.parentListIndex !== undefined
            ? subFragment.parentListIndex!
            : subFragment.parentMapKey!
        ]
    }
    return subDocument
  }
}

export const debugListFragmentIndexes = (listFragment: Fragment, extraInfo: string) => {
  // Debug that indexes are not correct
  const allListItems = Object.values(listFragment.value)
  const allListItemsIndexes = allListItems.map((item) => item.parentListIndex!)
  if (allListItemsIndexes.length !== new Set(allListItemsIndexes).size) {
    console.warn(`List fragment indexes are not unique. ${allListItemsIndexes}`, extraInfo)
  }
  const expectedIndexes = Array.from({ length: allListItems.length }, (_, i) => i)
  for (const expectedIndex of expectedIndexes) {
    if (!allListItemsIndexes.includes(expectedIndex)) {
      console.warn(
        `List fragment indexes are not correct. Missing index: ${expectedIndex}.`,
        extraInfo,
      )
    }
  }
}

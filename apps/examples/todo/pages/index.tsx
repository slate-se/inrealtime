import { Reorder } from 'framer-motion'
import { nanoid } from 'nanoid'
import { Inter } from 'next/font/google'
import { ChangeEvent, FormEvent, useCallback, useState } from 'react'

import { Avatars, Item } from '@/components'
import { usePatch, useDocumentStatus, useStore, useBroadcastListener, useBroadcast } from "@/realtime.config";
import { RealtimeDocumentStatus } from '@inrealtime/react'
const inter = Inter({ subsets: ['latin'] })

export default function Home() {
  const status = useDocumentStatus()
  const patch = usePatch()

  const [workingTitle, setWorkingTitle] = useState('')

  const items = useStore((root) => root?.todos)

  const onChangeTitle = (e: ChangeEvent<HTMLInputElement>) => {
    setWorkingTitle(e?.target?.value ?? '')
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!workingTitle?.length) {
      return
    }

    patch((root) => {
      if (!root.todos) {
        root.todos = []
      }

      root.todos.push({
        id: nanoid(16),
        label: workingTitle,
        isCompleted: false,
      })
    })
    setWorkingTitle('')
  }

  const onReorder = useCallback(
    (newOrder: any[]) => {
      const movedIndex = newOrder.findIndex((item, index) => item !== items?.[index])

      patch((root) => {
        if (!root?.todos) {
          return
        }

        root.todos.splice(movedIndex + 1, 0, root.todos.splice(movedIndex, 1)[0])
      })
    },
    [items, patch],
  )

  // TODO: Subscription example
  // const subscribe = useSubscribe()
  // useEffect(
  //   () => subscribe((root) => root.todos, console.log, { equalityFn: shallow }),
  //   [subscribe],
  // )

  // TODO: Broadcasting example
  // const broadcast = useBroadcast()
  useBroadcastListener((event) => {
    event.console.log('event', event.)
  })
  const broadcast = useBroadcast()
  broadcast('exampleEvent', { data: { example: 'data' } })

  return (
    <main className={`${inter.className}} min-h-screen wrapper`}>
      <h1 className='font-semibold text-xl sm:text-2xl lg:text-3xl mb-3 sm:mb-5'>
        inrealtime / examples / todo
      </h1>

      <p className='text-neutral-500 sm:text-lg mb-5 sm:mb-8 lg:mb-13'>
        The todo items below are written by users all over the world since this document is
        connected to the Realtime services. We take no responsibility for what they might say.
      </p>

      <div className=''>
        <Avatars />
      </div>

      <form onSubmit={onSubmit} className='flex items-center justify-between gap-3 mb-5'>
        <input
          id='newTodo'
          type='text'
          className='input w-full min-w-0'
          placeholder='New todo'
          maxLength={100}
          value={workingTitle}
          onChange={onChangeTitle}
        />

        <button type='submit' className='btn'>
          Add
        </button>
      </form>

      {status !== RealtimeDocumentStatus.Ready && (
        <div className='flex flex-col gap-3'>
          <div className='skeleton h-12 w-full rounded-md' />
          <div className='skeleton h-12 w-full rounded-md' />
          <div className='skeleton h-12 w-full rounded-md' />
          <div className='skeleton h-12 w-full rounded-md' />
        </div>
      )}

      {!!items?.length && (
        <Reorder.Group
          axis='y'
          values={items}
          onReorder={onReorder}
          className='flex flex-col gap-3'
        >
          {items?.map((item) => (
            <Item key={item.id} item={item} />
          ))}
        </Reorder.Group>
      )}
    </main>
  )
}

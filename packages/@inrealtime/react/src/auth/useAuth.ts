import { useCallback, useEffect, useMemo, useState } from 'react'

import { RealtimeConfig } from '../config'
import { GetRealtimeAuthToken, RealtimeAuth } from '../core'

// The initial wait time for re-trying on errors in milliseconds
const AuthenticationErrorExponentialTimerStart = 1000

// The maximum wait time for re-trying on errors in milliseconds
const AuthenticationErrorExponentialTimerMax = 8000

// The number of ms remaining until token expiry when we start re-authenticating
const ReAuthenticationTimeBeforeTokenExpiry = 2.5 * 60 * 1000 // 2.5 minutes

type AuthOptions = {
  documentId?: string
  groupId?: string
  getAuthToken?: GetRealtimeAuthToken
  publicAuthKey?: string
  config: RealtimeConfig
}

type AuthState = {
  status: AuthenticationStatus
  socketUrl?: string
  token?: string
  projectId?: string
}

enum AuthenticationStatus {
  Authenticating = 'Authenticating',
  Authenticated = 'Authenticated',
  Error = 'Error',
}

export const getJwtPayload = (token: string) => {
  const base64Url = token.split('.')[1]
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const jsonPayload = decodeURIComponent(
    atob(base64)
      .split('')
      .map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      })
      .join(''),
  )
  return JSON.parse(jsonPayload)
}

const authenticateFn = async ({
  realtimeAuth,
  documentId,
  groupId,
}: {
  realtimeAuth: RealtimeAuth
  documentId?: string
  groupId?: string
}) => {
  const { socketUrl, token, projectId } = await realtimeAuth.auth({ documentId, groupId })
  const tokenPayload = getJwtPayload(token)

  const tokenExpiryTime: number = tokenPayload.exp
  return { socketUrl, token, tokenExpiryTime, projectId }
}

export const useAuth = ({
  config,
  documentId,
  groupId,
  getAuthToken,
  publicAuthKey,
}: AuthOptions): AuthState => {
  const [authData, setAuthData] = useState<{
    socketUrl?: string
    token?: string
    tokenExpiryTime?: number
    projectId?: string
    documentId?: string
    groupId?: string
  }>({})
  const [status, setStatus] = useState<AuthenticationStatus>(AuthenticationStatus.Authenticating)

  // Exponential timer during error authenticating
  const [exponentialTimer, setExponentialTimer] = useState(0)

  const realtimeAuth = useMemo(() => {
    return new RealtimeAuth({ config, getAuthToken, publicAuthKey })
  }, [getAuthToken, publicAuthKey])

  const authenticate = useCallback(
    () => authenticateFn({ realtimeAuth, documentId, groupId }),
    [realtimeAuth, documentId, groupId],
  )

  // Re-authenticate during errors
  useEffect(() => {
    if (status !== AuthenticationStatus.Error) {
      return
    }

    const timer = setInterval(() => {
      setStatus(AuthenticationStatus.Authenticating)
    }, exponentialTimer)
    return () => {
      clearInterval(timer)
    }
  }, [status, exponentialTimer, setStatus])

  // Re-authenticate to refresh tokens
  useEffect(() => {
    if (status !== AuthenticationStatus.Authenticated || authData.tokenExpiryTime === undefined) {
      return
    }

    const timer = setInterval(() => {
      // If there is are ReAuthenticationTimeBeforeTokenExpiry ms till expiration we will trigger a re-authentication
      const diff =
        authData.tokenExpiryTime! - Date.now() / 1000 - ReAuthenticationTimeBeforeTokenExpiry / 1000
      if (diff < 0) {
        setStatus(AuthenticationStatus.Authenticating)
        if (config.logging.socketStatus) console.log('Auth status -> Authenticating')
      }
    }, 5000)
    return () => {
      clearInterval(timer)
    }
  }, [status, authData, setStatus])

  // If a document or project has changed for an already authenticated we need to reset the auth
  useEffect(() => {
    if (status !== AuthenticationStatus.Authenticated) {
      return
    }

    if (documentId === undefined && groupId === undefined) {
      return
    }

    if (
      (documentId !== undefined && authData.documentId === documentId) ||
      (groupId !== undefined && authData.groupId === groupId)
    ) {
      return
    }

    setAuthData({})
    setStatus(AuthenticationStatus.Authenticating)
    setExponentialTimer(0)
  }, [status, documentId, groupId])

  // Authenticate
  useEffect(() => {
    if (documentId === undefined && groupId === undefined) {
      setAuthData({})
      setStatus(AuthenticationStatus.Authenticating)
      setExponentialTimer(0)
      return
    }

    if (status !== AuthenticationStatus.Authenticating) {
      return
    }

    authenticate()
      .then(({ socketUrl, token, tokenExpiryTime, projectId }) => {
        setAuthData({ socketUrl, token, tokenExpiryTime, projectId, documentId, groupId })
        setStatus(AuthenticationStatus.Authenticated)
        if (config.logging.socketStatus) console.log('Auth status -> Authenticated')
      })
      .catch((e) => {
        console.error(e)

        setStatus(AuthenticationStatus.Error)
        if (config.logging.socketStatus) console.log("Auth status' -> Error")

        // Max wait is AuthenticationErrorExponentialTimerMax, start at AuthenticationErrorExponentialTimerStart ms, double each auth
        const newExponentialTimer = Math.min(
          AuthenticationErrorExponentialTimerMax,
          exponentialTimer < AuthenticationErrorExponentialTimerStart
            ? AuthenticationErrorExponentialTimerStart
            : exponentialTimer * 2,
        )
        setExponentialTimer(newExponentialTimer)
      })
  }, [status, authenticate, documentId, groupId])

  return {
    status,
    socketUrl: authData.socketUrl,
    token: authData.token,
    projectId: authData.projectId,
  }
}

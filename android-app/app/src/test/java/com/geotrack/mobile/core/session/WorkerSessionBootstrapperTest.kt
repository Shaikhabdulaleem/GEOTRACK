package com.geotrack.mobile.core.session

import com.geotrack.mobile.core.common.AppError
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.AppRole
import com.geotrack.mobile.domain.model.AuthSession
import com.geotrack.mobile.domain.model.EmployeeProfileInfo
import com.geotrack.mobile.domain.model.OrganizationContext
import com.geotrack.mobile.domain.model.OrganizationInfo
import com.geotrack.mobile.domain.model.OrganizationMembership
import com.geotrack.mobile.domain.repository.AuthRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Verifies the background session restoration contract that every
 * auto-attendance / reminder worker relies on before touching the server.
 */
class WorkerSessionBootstrapperTest {

    private fun context(org: String = "org-1") = OrganizationContext(
        membership = OrganizationMembership("m", org, AppRole.EMPLOYEE, true),
        profile = null,
        organization = OrganizationInfo(org, "Org", "org", "Asia/Riyadh"),
        department = null,
        assignedSite = null,
        assignedShift = null,
    )

    private fun profile() = EmployeeProfileInfo("emp-1", "Worker", "E1", "b", "d", null, "active")

    private class FakeAuth(private val result: AppResult<AuthSession?>) : AuthRepository {
        var restoreCalls = 0
        override val session: Flow<AuthSession?> = MutableStateFlow(null)
        override suspend fun restoreSession(): AppResult<AuthSession?> {
            restoreCalls++
            return result
        }
        override suspend fun signIn(email: String, password: String) = error("unused")
        override suspend fun signInWithIdentifier(identifier: String, password: String) = error("unused")
        override suspend fun requestPasswordReset(email: String) = error("unused")
        override suspend fun signOut() = error("unused")
    }

    private class FakeSession(
        initialContext: OrganizationContext? = null,
        initialProfile: EmployeeProfileInfo? = null,
        private val loaded: OrganizationContext? = null,
        private val loadedProfile: EmployeeProfileInfo? = null,
        private val loadFails: Boolean = false,
    ) : SessionRepository {
        override val organizationContext = MutableStateFlow(initialContext)
        override val employeeProfile = MutableStateFlow(initialProfile)
        var loadCalls = 0
        override suspend fun loadContext(userId: String): AppResult<OrganizationContext?> {
            loadCalls++
            if (loadFails) return AppResult.Failure(AppError.Network("offline"))
            organizationContext.value = loaded
            employeeProfile.value = loadedProfile
            return AppResult.Success(loaded)
        }
        override fun clearContext() {
            organizationContext.value = null
            employeeProfile.value = null
        }
    }

    @Test
    fun `cold process restores the session and loads the employee profile`() = runBlocking {
        val auth = FakeAuth(AppResult.Success(AuthSession("u1", true)))
        val session = FakeSession(loaded = context(), loadedProfile = profile())
        val bootstrapper = WorkerSessionBootstrapper(auth, session)

        val restored = bootstrapper.restore()

        assertNotNull(restored)
        assertEquals("org-1", restored?.organization?.id)
        assertNotNull(session.employeeProfile.value)
        assertEquals(1, session.loadCalls)
    }

    @Test
    fun `warm process with context and profile does not reload`() = runBlocking {
        val auth = FakeAuth(AppResult.Success(AuthSession("u1", true)))
        val session = FakeSession(initialContext = context(), initialProfile = profile())
        val bootstrapper = WorkerSessionBootstrapper(auth, session)

        val restored = bootstrapper.restore()

        assertNotNull(restored)
        assertEquals(0, session.loadCalls) // reused in-memory
        assertEquals(0, auth.restoreCalls)
    }

    @Test
    fun `warm context without a profile triggers a reload`() = runBlocking {
        val auth = FakeAuth(AppResult.Success(AuthSession("u1", true)))
        // Context present but profile flow empty (e.g. profile cleared in a warm process).
        val session = FakeSession(
            initialContext = context(),
            initialProfile = null,
            loaded = context(),
            loadedProfile = profile(),
        )
        val bootstrapper = WorkerSessionBootstrapper(auth, session)

        bootstrapper.restore()

        assertEquals(1, session.loadCalls)
        assertNotNull(session.employeeProfile.value)
    }

    @Test
    fun `signed-out device restores nothing`() = runBlocking {
        val auth = FakeAuth(AppResult.Success(null)) // no persisted session
        val session = FakeSession()
        val bootstrapper = WorkerSessionBootstrapper(auth, session)

        assertNull(bootstrapper.restore())
        assertEquals(0, session.loadCalls)
    }

    @Test
    fun `restore failure offline keeps any cached context`() = runBlocking {
        val auth = FakeAuth(AppResult.Failure(AppError.Network("offline")))
        val session = FakeSession(initialContext = context(), initialProfile = null)
        val bootstrapper = WorkerSessionBootstrapper(auth, session)

        // Auth restore failed, but a previously cached context is still returned
        // rather than nulling out an in-flight session.
        val restored = bootstrapper.restore()
        assertNotNull(restored)
    }
}

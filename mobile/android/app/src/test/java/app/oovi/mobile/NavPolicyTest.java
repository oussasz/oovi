package app.oovi.mobile;

import static app.oovi.mobile.NavPolicy.Action.*;
import static org.junit.Assert.*;

import org.junit.Test;

public class NavPolicyTest {

    @Test
    public void appPagesStayInTheApp() {
        assertEquals(IN_APP, NavPolicy.decide("https://oovi.conuron.com/m"));
        assertEquals(IN_APP, NavPolicy.decide("https://oovi.conuron.com/m/c/abc?x=1"));
        assertEquals(IN_APP, NavPolicy.decide("https://oovi.conuron.com/m/connectors?connected=notion"));
        assertEquals(IN_APP, NavPolicy.decide("https://OOVI.conuron.com/app/settings"));
        assertEquals(IN_APP, NavPolicy.decide("https://oovi.conuron.com/login?next=/m"));
        assertEquals(IN_APP, NavPolicy.decide("https://oovi.conuron.com/signup?next=/m"));
        assertEquals(IN_APP, NavPolicy.decide("https://oovi.conuron.com/forgot-password"));
        assertEquals(IN_APP, NavPolicy.decide("https://oovi.conuron.com/reset-password?token=t"));
        assertEquals(IN_APP, NavPolicy.decide("data:text/plain,hi"));
        assertEquals(IN_APP, NavPolicy.decide("blob:https://oovi.conuron.com/1234"));
    }

    @Test
    public void otherPagesOpenInTheBrowser() {
        assertEquals(BROWSER, NavPolicy.decide("https://oovi.conuron.com/download"));
        assertEquals(BROWSER, NavPolicy.decide("https://oovi.conuron.com/privacy"));
        assertEquals(BROWSER, NavPolicy.decide("https://oovi.conuron.com/"));
        assertEquals(BROWSER, NavPolicy.decide("https://oovi.conuron.com/mail")); // not /m
        assertEquals(BROWSER, NavPolicy.decide("https://oovi.conuron.com/apps")); // not /app
        assertEquals(BROWSER, NavPolicy.decide("https://accounts.google.com/o/oauth2/auth?x=1"));
        assertEquals(BROWSER, NavPolicy.decide("https://example.com/m"));
        assertEquals(BROWSER, NavPolicy.decide("https://oovi.conuron.com.evil.example/m"));
        assertEquals(BROWSER, NavPolicy.decide("https://oovi.conuron.com:8443/m"));
        assertEquals(BROWSER, NavPolicy.decide("http://oovi.conuron.com/m"));
    }

    @Test
    public void otherAppsAndBlocked() {
        assertEquals(OTHER_APP, NavPolicy.decide("mailto:hello@example.com"));
        assertEquals(OTHER_APP, NavPolicy.decide("tel:+213555"));
        assertEquals(BLOCK, NavPolicy.decide("javascript:alert(1)"));
        assertEquals(BLOCK, NavPolicy.decide("file:///data/data/app.oovi.mobile/x"));
        assertEquals(BLOCK, NavPolicy.decide("content://x/y"));
        assertEquals(BLOCK, NavPolicy.decide("intent://scan/#Intent;scheme=zxing;end"));
        assertEquals(BLOCK, NavPolicy.decide("not a url"));
        assertEquals(BLOCK, NavPolicy.decide(null));
    }

    @Test
    public void deepLinks() {
        assertEquals("https://oovi.conuron.com/m/c/abc?x=1", NavPolicy.deepLink("https://oovi.conuron.com/m/c/abc?x=1"));
        assertEquals("https://oovi.conuron.com/m", NavPolicy.deepLink("https://oovi.conuron.com/m"));
        assertNull(NavPolicy.deepLink("https://oovi.conuron.com/download"));
        assertNull(NavPolicy.deepLink("https://oovi.conuron.com/mx"));
        assertNull(NavPolicy.deepLink("http://oovi.conuron.com/m"));
        assertNull(NavPolicy.deepLink("https://evil.example/m"));
        assertNull(NavPolicy.deepLink("app.oovi.mobile://m"));
        assertNull(NavPolicy.deepLink(null));
    }

    @Test
    public void backLeavesOnlyFromTheListOrSignIn() {
        assertTrue(NavPolicy.exitsOnBack("https://oovi.conuron.com/m"));
        assertTrue(NavPolicy.exitsOnBack("https://oovi.conuron.com/m/"));
        assertTrue(NavPolicy.exitsOnBack("https://oovi.conuron.com/m?source=pwa"));
        assertTrue(NavPolicy.exitsOnBack("https://oovi.conuron.com/m/login"));
        assertTrue(NavPolicy.exitsOnBack("https://oovi.conuron.com/offline.html#/m"));
        assertFalse(NavPolicy.exitsOnBack("https://oovi.conuron.com/m/c/abc"));
        assertFalse(NavPolicy.exitsOnBack("https://oovi.conuron.com/m/settings"));
        assertFalse(NavPolicy.exitsOnBack("https://oovi.conuron.com/signup?next=/m"));
    }

    @Test
    public void retryGoesBackToAnAppPageOnly() {
        assertEquals("/m/c/abc?x=1", NavPolicy.retryPath("https://oovi.conuron.com/m/c/abc?x=1"));
        assertEquals("/m", NavPolicy.retryPath("https://oovi.conuron.com/api/v1/cloud/chats"));
        assertEquals("/m", NavPolicy.retryPath("https://evil.example/m"));
        assertEquals("/m", NavPolicy.retryPath(null));
        assertEquals("/login?next=/m", NavPolicy.retryPath("https://oovi.conuron.com/login?next=/m"));
    }
}

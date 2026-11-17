// The display toggles for email and location used to hide them only in the UI,
// while the page bootstrap and the public profile API still carried the values.
// Clear hidden personal fields before a profile is sent to readers; the admin
// editor keeps receiving the full profile so saving never erases them.
export const toPublicProfile = (profile) => {
    if (!profile || typeof profile !== 'object') return profile;
    const display = profile.display ?? {};
    return {
        ...profile,
        email: display.showEmail === false ? '' : profile.email,
        location: display.showLocation === false ? '' : profile.location
    };
};

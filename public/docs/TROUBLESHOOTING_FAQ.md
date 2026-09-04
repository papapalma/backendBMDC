# Troubleshooting & FAQ - Program Sharing

A comprehensive guide to common issues and frequently asked questions about program sharing.

---

## Table of Contents

1. [Quick Troubleshooting](#quick-troubleshooting)
2. [FAQ by User Type](#faq-by-user-type)
3. [Common Scenarios & Solutions](#common-scenarios--solutions)
4. [Browser & Device Issues](#browser--device-issues)
5. [Permission & Access Issues](#permission--access-issues)
6. [When to Contact Support](#when-to-contact-support)

---

## Quick Troubleshooting

### The 3-Step Quick Fix

**Try these before contacting support:**

1. **Refresh the page**
   - Press F5 or Ctrl+R (Cmd+R on Mac)
   - Wait 5 seconds for the page to fully reload

2. **Clear browser cache**
   - Settings → Privacy/History → Clear browsing data
   - Select "Cookies and cached images"
   - Click "Clear data"
   - Refresh the page again

3. **Try a different browser**
   - If issue persists, open Chrome, Firefox, Safari, or Edge
   - Try the same action in the new browser

**If the issue persists after these steps, continue below or contact support.**

---

## FAQ by User Type

### For Admins/Instructors

#### Q: How do I generate a share link?
**A:** 
1. Navigate to the program you want to share
2. Click the "Generate Share Link" button (usually in the header)
3. Click "Copy to Clipboard"
4. Paste the link anywhere you want to share it

#### Q: Do I need to generate a new link each time I share?
**A:** 
No. Each program has one permanent share link. Generating the link multiple times produces the same URL. You can share this URL as many times as needed.

#### Q: What if I can't find the Share Link button?
**A:** 
The Share Link button may not be visible if:
- You're not an admin or program owner
- The program isn't published yet
- The program was archived

**Solution**: Verify you have admin permissions and the program is active.

#### Q: Can I see how many people clicked my share link?
**A:** 
Yes! Check the program's Analytics section:
1. Go to the program
2. Click "Analytics" or "Performance" tab
3. View "Link Clicks" metric
4. See enrollment conversion rates

#### Q: What happens if I change the program details after sharing?
**A:** 
All changes appear immediately:
- Social media previews update within hours
- Users see the latest program information
- Existing enrollments aren't affected

#### Q: Can I change the share link URL?
**A:** 
No. The share link is permanent and tied to the program. You cannot customize the URL, but you can:
- Share it with different messages on different platforms
- Use it in different marketing campaigns
- Add tracking parameters (e.g., `?utm_source=facebook`) when sharing

#### Q: What if my program goes offline after I've shared the link?
**A:** 
Users who click the link will see:
```
❌ This program is no longer available
```
**Solution**: 
- Archive programs instead of deleting them to show a better message
- Or reactivate the program if you want to share it again

---

### For Trainees/Students

#### Q: What's a shared program link?
**A:** 
It's a special URL that takes you directly to a program with pre-selected enrollment. Instead of searching for the program, it's already chosen for you.

#### Q: Do I need an account to click a shared link?
**A:** 
You don't need to have an account beforehand. The link will either:
- Direct you to sign up (if you're new)
- Direct you to log in (if you already have an account)
- Guide you to enrollment

#### Q: Can I still find the program later if I don't enroll now?
**A:** 
Yes. Even after clicking the shared link:
- You can search for the program in the programs catalog
- The link doesn't disappear
- You can enroll later through the normal process

#### Q: What happens if I close the browser during enrollment?
**A:** 
Your program selection is saved in your browser. When you return:
1. Open the link again (or go to the app)
2. You'll still see the program is pre-selected
3. You can continue the enrollment process
4. No progress is lost

#### Q: After I enroll, will the program context stay?
**A:** 
No. After successful enrollment, the program context is automatically cleared. This doesn't affect your enrollment—the program remains in your dashboard permanently.

#### Q: Can I share the link with others?
**A:** 
Yes! The share link is public and can be shared with anyone. When others click it, they'll follow the same process (login, signup, or enrollment).

---

## Common Scenarios & Solutions

### Scenario 1: Admin wants to track link performance

**Goal**: See how many people are clicking the shared link

**Solution**:
1. Generate the share link for your program
2. Navigate to program analytics
3. Look for "Traffic Sources" or "Link Performance"
4. View metrics:
   - Click count
   - Unique visitors
   - Enrollment conversion rate
   - Peak traffic times

**Additional Tips**:
- Use different messages on different platforms to see which performs best
- Track best-performing social media platforms
- Adjust messaging based on performance data

---

### Scenario 2: New user can't access program after clicking link

**Goal**: Resolve access issues for new users

**Symptoms**: 
- "Page not found" error
- "Permission denied" message
- Blank page after clicking link

**Solution**:

**Step 1: Verify the link is correct**
- Ask the admin to regenerate the link
- Copy directly from the generator, not retyped
- Check for typos in the URL

**Step 2: Check program status**
- Admin should verify the program is "Active" and "Published"
- Program must allow public enrollment
- Program capacity should have available spots

**Step 3: Clear browser and try again**
- Clear browser cache (Settings → Privacy → Clear data)
- Try the link again
- Try a different browser

**Step 4: Contact support**
- Email: support@yourapp.com
- Include the full link URL
- Screenshot of error message

---

### Scenario 3: Trainee logged in but didn't auto-redirect to program page

**Goal**: Get trainee to program details after login

**Symptoms**:
- Logged in successfully
- But redirected to dashboard instead of program
- Don't see program details modal

**Likely Cause**: 
- LocalStorage was cleared
- Browser cache interfered
- Pop-up blocker blocked the modal

**Solution**:

**Option 1: Clear cache and try again**
1. Clear browser cache (Settings → Privacy → Clear data)
2. Close browser completely
3. Click the share link again
4. Try the complete flow again

**Option 2: Manual navigation**
1. After login, go to Programs/Dashboard
2. Search for the program by name
3. Click on the program
4. Click "Enroll"

**Option 3: Check modal settings**
- Settings → Permissions → Pop-ups
- Make sure pop-ups are allowed
- Add the domain to exceptions

---

### Scenario 4: Signup with pre-selected program works, but user enrolled in wrong program

**Goal**: Correct the enrollment

**Symptoms**:
- Enrolled, but in the wrong program
- Program was changed during signup

**Solution**:

**For the User**:
1. Log in to your account
2. Go to your Dashboard
3. Find the incorrect program enrollment
4. Click the program and look for "Unenroll" or "Leave Program" option
5. Contact instructor if the option isn't available
6. Click the correct share link and enroll in the right program

**For the Admin**:
1. If a user enrolled in the wrong program:
   - Go to the program
   - Find the user in the enrollment list
   - Click the user and select "Remove from Program"
   - Notify the user they can now enroll in the correct program

---

### Scenario 5: Program link shared but users see old/incorrect preview on social media

**Goal**: Update the social media preview

**Symptoms**:
- Link shared on Facebook/LinkedIn
- Preview shows old program image or wrong title
- Program details were updated but preview didn't

**Likely Causes**:
- Social platform cached the old preview
- Program image missing or too small
- Program description missing or too short

**Solution**:

**Step 1: Update program details**
- Go to program settings
- Ensure program title is clear and descriptive
- Add or update program image (minimum 1200x630 pixels recommended)
- Add detailed program description
- Save changes

**Step 2: Clear social platform cache**

**For Facebook**:
1. Go to facebook.com/sharer/debug
2. Paste your link
3. Click "Scrape Again"
4. Wait for refresh

**For LinkedIn**:
1. Go to linkedin.com/inspector
2. Paste your link
3. Click "Inspect URL"
4. Wait for update

**For Twitter/X**:
1. Go to twitter.com/share
2. Paste your link
3. Preview updates automatically

**Step 3: Re-share the link**
- Share the link again after cache clears
- The new preview will display

---

## Browser & Device Issues

### Issue: Works on Chrome but not Firefox

**Causes**:
- Different browser settings
- Extensions interfering
- Cached data conflicts

**Solution**:
1. **Firefox**:
   - Edit → Preferences → Privacy
   - Clear cache and cookies
   - Disable extensions one by one
   - Test after each

2. **Chrome**:
   - Settings → Privacy and security
   - Clear browsing data
   - Disable extensions
   - Try incognito window

3. **Both**:
   - Update browser to latest version
   - Try another browser (Safari/Edge) to isolate issue

---

### Issue: Mobile app redirects don't work correctly

**Symptoms**:
- Link works on desktop but not on phone
- Mobile browser closes unexpectedly
- Redirect loop on mobile

**Solution**:
1. **Clear mobile browser cache**
   - Settings → Apps → Browser
   - Storage → Clear Cache
   - Restart phone

2. **Try different browser**
   - Chrome, Firefox, Safari (different from default)
   - Compare behavior

3. **Use mobile app instead**
   - Download the native mobile app
   - Some features work better in native app
   - Open link with app instead of browser

4. **Enable JavaScript**
   - Mobile settings → Browser settings
   - Ensure JavaScript is enabled
   - Some features require JavaScript

---

### Issue: Doesn't work on older iPhone (Safari)

**Symptoms**:
- Blank page on older Safari versions
- "Page not supported" error
- Features work on newer devices

**Likely Causes**:
- Older Safari doesn't support latest web features
- iOS version too old
- Browser doesn't support required JavaScript

**Solution**:
1. **Update iOS/Safari**
   - Settings → General → Software Update
   - Update to latest iOS version

2. **Update Safari**
   - App Store → Updates
   - Update Safari to latest

3. **Try different browser**
   - Download Chrome or Firefox from App Store
   - Try link in alternative browser

4. **Workaround**:
   - Sign up normally in Programs list
   - After enrolling, ask instructor to add you to shared program

---

### Issue: Pop-up/modal blocked by browser

**Symptoms**:
- Modal doesn't appear after login
- Site says "Pop-ups are blocked"
- Have to manually open program details

**Solution**:
1. **Enable pop-ups** (Chrome):
   - Settings → Privacy and security → Site settings
   - Pop-ups and redirects
   - Add yourapp.com to "Allow"

2. **Enable pop-ups** (Firefox):
   - Settings → Privacy & Security
   - Scroll to "Permissions"
   - Uncheck "Block pop-up windows"

3. **Disable pop-up blocker** (Safari):
   - Settings → Websites → Pop-ups
   - Select "Allow" for the domain

4. **Browser extension blocking**:
   - Check browser extensions (Tools → Extensions)
   - Disable pop-up blockers or ad blockers
   - Reload page

---

## Permission & Access Issues

### Issue: "Permission Denied" / "You don't have access"

**Symptoms**:
- Click shared link, get "Permission Denied" error
- Program shows but can't enroll
- "Insufficient privileges" message

**Possible Causes**:

1. **Program is private/restricted**
   - Only certain users can access
   - May require instructor approval
   - **Solution**: Contact the instructor to request access

2. **Program at capacity**
   - All enrollment slots filled
   - No more students can enroll
   - **Solution**: Contact instructor about waiting list

3. **Account doesn't meet prerequisites**
   - You don't have required experience level
   - Missing prerequisite programs
   - **Solution**: Complete prerequisite programs first, or contact instructor for exception

4. **Account has restrictions**
   - Your account may be flagged or restricted
   - Login permissions may be limited
   - **Solution**: Contact support to verify account status

---

### Issue: Can't enroll despite having permission

**Symptoms**:
- Program shows as valid
- Permission check passes
- But enrollment button doesn't work

**Possible Causes**:

1. **Already enrolled**
   - You may already be enrolled
   - Can't enroll twice
   - **Solution**: Check your dashboard to confirm

2. **Form errors**
   - Required fields empty
   - Invalid data format
   - **Solution**: Complete all fields, check data format

3. **System temporary issue**
   - Server error during enrollment
   - Database connection issue
   - **Solution**: Refresh page and try again, or contact support

---

### Issue: "Link is invalid" or "Program not found"

**Symptoms**:
- Link leads to error page
- "This program could not be found"
- "Invalid program ID" message

**Possible Causes**:

1. **Program was deleted/archived**
   - Instructor removed the program
   - Program is no longer active
   - **Solution**: Contact instructor about program status

2. **Invalid link format**
   - URL is incorrect or incomplete
   - Query parameter malformed
   - **Solution**: Ask for the link to be shared again

3. **Link typo**
   - URL was mistyped when copied
   - Parameter was truncated
   - **Solution**: Get the full link from instructor directly

4. **System issue**
   - Temporary server error
   - Database connection problem
   - **Solution**: Wait 5 minutes and try again

---

## When to Contact Support

### Contact Support If:

✅ **You've tried all troubleshooting steps above**

✅ **Issue persists after:**
- Clearing browser cache
- Trying different browser
- Refreshing page multiple times
- Waiting at least 30 minutes

✅ **You see error codes** (e.g., 500, 502, 503, 404)

✅ **Feature doesn't work on multiple devices**

✅ **Program details display incorrectly**

### Don't Contact Support For:

❌ "How do I use this feature?" → See the guides instead
❌ "How do I share a link?" → See admin guide
❌ General feature questions → Check FAQ first
❌ Account password reset → Use "Forgot Password" link

---

## How to Contact Support

### Support Channels

**📧 Email Support** (Best for detailed issues)
- Email: support@yourapp.com
- Response time: 24 hours
- Include:
  - Your account email
  - Problem description
  - Error message (if any)
  - Screenshot (if applicable)
  - Steps to reproduce issue
  - Browser and device information

**💬 Live Chat** (Best for quick questions)
- Available during business hours
- In-app chat button
- Response time: Usually within 30 minutes
- Best for: Quick troubleshooting, simple questions

**📞 Phone Support** (If available)
- 1-800-SUPPORT or [your number]
- Business hours: [Your hours]
- Best for: Complex issues, urgent help

**📋 Help Ticket System**
- In-app: Click "?" icon → "Report an issue"
- Fill out issue form with details
- Track ticket status via email

### Information to Include

When contacting support, provide:

```
Account Email: [your email]
Issue Title: [One sentence summary]

Description:
[Detailed description of issue]

Steps to Reproduce:
1. [First step]
2. [Second step]
3. [What happened]

Error Message:
[Exact error text]

Screenshots/Screencasts:
[Attached if possible]

Device/Browser Info:
- Device: [Phone/Laptop/Tablet]
- OS: [Windows/Mac/iOS/Android]
- Browser: [Chrome/Firefox/Safari/Edge]
- Browser Version: [e.g., 120.0]

Troubleshooting Tried:
- [What you've already tried]
- [Previous solutions attempted]
```

---

## Frequently Asked Questions

### General Questions

**Q: Is there a video tutorial?**
A: Yes! Check these resources:
- YouTube: Search "Program Sharing Tutorial"
- In-app: Hover over icons for tooltips
- Admin portal: Training section
- [Coming Soon] Video walkthrough

**Q: What if I have multiple programs?**
A: Each program gets its own link. Share different links for different programs.

**Q: Can users share the link with others?**
A: Yes! The link is public and designed to be shared widely. Others can use it to enroll.

**Q: Does the link work internationally?**
A: Yes! The app works worldwide. Language and currency may adjust based on location.

---

### Account & Security Questions

**Q: Is my password secure when I sign up through a shared link?**
A: Yes. All passwords use industry-standard encryption. The shared link doesn't affect security.

**Q: Can someone else sign up using my link?**
A: Yes, but they create their own account. The link doesn't give them access to your account.

**Q: What if I forgot my password?**
A: Use the "Forgot Password" link on the login page. You'll receive an email with reset instructions.

**Q: Can I link my social media account for login?**
A: Some platforms may support this. Check Login Options on the login page.

---

### Technical Questions

**Q: What's the difference between the link preview and the actual program?**
A: The preview (title, image, description) comes from your program details. The actual program page always shows the most current information.

**Q: Why doesn't my share link have a preview on social media?**
A: Check that your program has:
- Title (not empty)
- Description (at least 50 characters)
- Image (at least 1200x630 pixels)
- Then refresh the social platform cache

**Q: Can I use tracking parameters with the share link?**
A: Yes! You can add parameters like:
- `?utm_source=facebook`
- `?utm_medium=social`
- These help track where signups came from

**Q: Does the share link track my personal data?**
A: No personal data is collected from the link itself. Only aggregate usage (click count) is tracked.

---

## Escalation Procedures

### When to Escalate

If your issue is not resolved after:
1. Trying all troubleshooting steps
2. Waiting 24 hours for response
3. Contacting support once

**Request Escalation**:
- Reply to support email with "ESCALATE" in subject
- Or mention escalation in chat
- Include all previous communications
- Explain why the standard solution didn't work

### Who Handles Escalations

- Level 1: General support
- Level 2: Technical specialist (48 hours)
- Level 3: Engineering team (5 business days)
- Level 4: Product manager (if feature issue)

---

## Success Checklist

Before sharing your program link, verify:

✅ **Program Details**
- [ ] Title is clear and descriptive
- [ ] Description is complete and compelling
- [ ] Image is uploaded and high quality
- [ ] Program status is "Active"
- [ ] Enrollment is open

✅ **Link Generation**
- [ ] Link copied correctly
- [ ] Link contains your program ID
- [ ] Link works when tested

✅ **Social Media**
- [ ] Preview appears correctly on platform
- [ ] Message is compelling
- [ ] Link is working

✅ **User Access**
- [ ] New users can sign up
- [ ] Existing users can log in
- [ ] Program auto-opens after auth
- [ ] Enrollment button works

---

## Additional Resources

- **Admin/Instructor Guide**: [Link to guide]
- **Trainee/Student Guide**: [Link to guide]
- **Feature Overview**: [Link to overview]
- **Video Tutorials**: [Link to videos]
- **API Documentation**: [Link to docs]

---

**Still have questions? Reach out to support@yourapp.com** 📧

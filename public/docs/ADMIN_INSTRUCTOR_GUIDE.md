# Admin & Instructor Guide: Program Sharing

## Getting Started

This guide explains how to generate and share program links with your audience. It's designed for instructors, administrators, and program managers who want to promote training programs on social media.

---

## Table of Contents

1. [Generating Share Links](#generating-share-links)
2. [Understanding Your Share Link](#understanding-your-share-link)
3. [Social Media Sharing Options](#social-media-sharing-options)
4. [QR Code Generation](#qr-code-generation)
5. [Analytics and Tracking](#analytics-and-tracking)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Generating Share Links

### Step-by-Step Link Generation

**Step 1: Navigate to Your Program**
- Log in to your instructor/admin account
- Go to "Programs" or "My Programs" section
- Click on the program you want to share

**Step 2: Find the Share Button**
- Look for the "Generate Share Link" button in the program header or toolbar
- It's typically marked with a share icon (🔗 or 📤)
- Click this button to generate a shareable link

**Step 3: View Your Link**
- A dialog box appears with your generated link
- The link is unique to that program
- Each time you generate a link for the same program, it produces the same URL (for consistency)

**Step 4: Copy the Link**
- Click the "Copy to Clipboard" button
- You'll see a confirmation: "Link copied!"
- The link is now ready to share anywhere

### Example Share Link

```
https://yourapp.com/share?program_id=550e8400-e29b-41d4-a716-446655440000
```

---

## Understanding Your Share Link

### What's in the URL?

Your share link contains:
- **Base URL**: `https://yourapp.com/share` - the sharing entry point
- **Program ID**: The unique identifier for your program
- **No Personal Data**: The link doesn't contain any sensitive information

### Link Characteristics

- **Unique per Program**: Each program gets its own link
- **Permanent**: The link doesn't expire as long as the program is active
- **Public**: Anyone with the link can access the program enrollment
- **Idempotent**: Generating the link multiple times produces the same URL

### What Users Will See

When someone clicks your share link:
1. The app extracts the program ID
2. Shows a loading screen briefly
3. Redirects them to login/signup with the program pre-selected
4. Users never see the raw query parameter

---

## Social Media Sharing Options

### Option 1: Manual Copy & Paste (All Platforms)

**Best for**: When you want to customize your message

1. Copy your share link from the Program Link Generator
2. Open your social media platform
3. Paste the link in your post, along with your custom message
4. The platform automatically creates a preview with:
   - Program name
   - Program description
   - Program image thumbnail

### Option 2: Facebook

**Why Share on Facebook?**
- Large audience of potential learners
- Great preview display
- Easy sharing in groups and community pages

**How to Share:**

1. Copy your share link
2. Open Facebook and create a new post
3. Paste the link in the post text box
4. Facebook automatically fetches a preview
5. Write your promotional message above or below the link
6. Click "Post"

**Tips:**
- Share in relevant training/education groups
- Use hashtags like #Training #LearningOpportunity #ProfessionalDevelopment
- Post during peak hours when your audience is most active
- Share multiple times (spacing posts out over days/weeks)

### Option 3: Twitter / X

**Why Share on Twitter?**
- Quick reach to professionals
- Easy to retweet and share
- Good for time-sensitive announcements

**How to Share:**

1. Copy your share link
2. Open Twitter/X and compose a new tweet
3. Paste the link with a short, engaging message
4. Keep your message under 280 characters total
5. Use relevant hashtags
6. Post your tweet

**Sample Tweets:**

```
📚 New training program available! "Advanced Excel Mastery"
Join our program and level up your skills. 
[link] #Training #ProfessionalGrowth
```

```
🎯 Looking to advance your career?
Check out our latest program on data analysis.
Limited spots available! [link] #DataAnalytics
```

### Option 4: LinkedIn

**Why Share on LinkedIn?**
- Professional network
- Reaches working professionals
- Great for B2B and corporate training

**How to Share:**

1. Copy your share link
2. Go to LinkedIn
3. Create a new post or article
4. Share your link with professional details about the program
5. Explain who should take this training
6. Use professional hashtags

**Tips:**
- Add a brief description of program benefits
- Mention target audience (job roles, skill levels)
- Share testimonials or results from previous participants
- Include relevant keywords for discoverability

### Option 5: WhatsApp & Messenger

**Why Share on WhatsApp?**
- Direct communication with interested contacts
- Personal and effective
- Good for closed communities

**How to Share:**

1. Copy your share link
2. Open WhatsApp or Messenger
3. Send the link to relevant groups or individuals
4. Add a personal message about why you're recommending the program
5. The link preview appears automatically

**Tips:**
- Share with people who match the program's target audience
- Provide context about the program's value
- Offer to answer questions about the program

### Option 6: Email

**Why Share via Email?**
- Professional and direct
- Reaches specific audiences
- Easy to track
- Great for newsletters

**How to Share:**

1. Copy your share link
2. Compose an email
3. Include your program information and the link
4. Add context and call-to-action
5. Send to your mailing list

**Email Template:**

```
Subject: Exciting New Training Program - Register Now!

Hi [Name],

I'm excited to share a new training program that I think would be 
valuable for you:

Program: [Program Name]
Description: [Brief description of the program]
Duration: [Program duration]
Start Date: [When it begins]

This program covers [key topics] and is perfect for [target audience].

Enroll here: [Your Share Link]

Best regards,
[Your Name]
```

---

## QR Code Generation

### Creating a QR Code

**Option 1: Use Online QR Code Generator**

1. Copy your share link
2. Go to a QR code generator (e.g., qr-code-generator.com)
3. Paste your link
4. Download the QR code image
5. Use it in your marketing materials

**Option 2: Built-in QR Code Feature** (if available)

Some platforms may have built-in QR code generation:
1. In the Program Link Generator dialog
2. Look for "Generate QR Code" button
3. Download the QR code image

### Using QR Codes in Your Marketing

**Print Materials**
- Add QR code to flyers and brochures
- Add QR code to program announcements
- Include QR code in newsletter emails

**Digital Use**
- Add QR code to blog posts or website
- Include in social media posts
- Share in PowerPoint presentations

**Best Practices**
- Make QR code at least 1 cm x 1 cm (for print)
- Test QR code before publishing
- Include text near QR: "Scan to enroll in our program"
- Use high-quality images

---

## Analytics and Tracking

### Monitoring Link Performance

When you generate share links, you can track:
- **Click-Through Rate**: How many people clicked your shared link
- **Enrollment Rate**: How many people who clicked actually enrolled
- **Conversion Timeline**: When people clicked and enrolled
- **Traffic Source**: Where the clicks came from (if using tracking parameters)

### How to View Analytics

1. Go to the program you shared
2. Look for "Analytics" or "Performance" tab
3. Select your time period (last week, last month, etc.)
4. View metrics:
   - Total link clicks
   - Unique visitors
   - Enrollment completions
   - Drop-off points

### Using Analytics for Improvement

- **Low Click-Through Rate?** 
  - Try different messaging
  - Share at different times
  - Use more engaging visuals
  
- **Clicks But No Enrollments?**
  - Program details may be unclear
  - Consider program prerequisites
  - Simplify enrollment process
  
- **High Enrollment Rate?**
  - Share more frequently
  - Try additional platforms
  - Replicate successful messaging

---

## Best Practices

### General Sharing Strategy

**1. Know Your Audience**
- Who should take this program?
- What problem does it solve for them?
- Where do they spend time online?

**2. Craft Compelling Messages**
- Be clear about program benefits
- Highlight outcomes and skills gained
- Create urgency (limited spots, time-bound opportunities)
- Use action-oriented language

**3. Share Consistently**
- Share the link multiple times (not just once)
- Space posts out over days/weeks
- Different platforms, different timing
- Engage with comments and questions

**4. Use Visuals**
- Use professional program images in social posts
- Create graphics highlighting key benefits
- QR codes make sharing convenient
- Video previews increase engagement

### Content Ideas for Sharing

**Highlight Program Benefits**
```
🎓 Master [Skill Name] in [Duration]
Learn from industry experts and boost your career.
Enroll now: [link]
```

**Create Urgency**
```
⏰ Only 10 spots left in our [Program Name]
Enrollment closes [Date]. Join today: [link]
```

**Share Results**
```
✅ 95% of our trainees report improved job performance
Be the next success story: [link]
```

**Answer Common Questions**
```
❓ No experience? No problem!
Our [Program Name] is perfect for beginners.
Learn more: [link]
```

### Timing Tips

- **Best Times to Share**:
  - Early morning (6-9 AM)
  - Lunch time (12-1 PM)
  - Evening (5-7 PM)
  - Adjust based on your audience
  
- **Share Frequency**:
  - Facebook: 1-2 times per week
  - Twitter: 1-2 times per day
  - LinkedIn: 2-3 times per week
  - Email: 1-2 times per month

### Engagement Tips

- **Respond to Questions**: Answer inquiries promptly
- **Share Testimonials**: Show success stories from previous participants
- **Create Series**: Share program series, not just individual links
- **Collaborate**: Share each other's programs with partner organizations

---

## Troubleshooting

### Issue: Link Not Working

**Symptom**: "Page not found" when clicking the link

**Possible Causes & Solutions**:
1. **Program is inactive**: Activate the program in settings
2. **Program has enrollment restrictions**: Check if program is set to "Public"
3. **Link was mistyped**: Copy the link directly from the generator
4. **Browser issue**: Try a different browser or clear browser cache

### Issue: Program Details Not Showing on Social Media

**Symptom**: No preview image or description when posting the link

**Possible Causes & Solutions**:
1. **Missing program image**: Upload a program image (at least 1200x630 pixels)
2. **Missing description**: Add a detailed program description
3. **Social platform cache**: Wait a few minutes, then try again
4. **Invalid URL**: Verify the link was copied correctly

### Issue: High Bounce Rate After Click

**Symptom**: Many people click the link but don't enroll

**Possible Causes & Solutions**:
1. **Misleading message**: Ensure your social post accurately describes the program
2. **Program requirements not clear**: Add prerequisites to program details
3. **Difficult enrollment**: Simplify the signup process if possible
4. **Program full**: Check if enrollment capacity is reached

### Issue: Link Expired or Stopped Working

**Symptom**: Link worked before, but now returns an error

**Possible Causes & Solutions**:
1. **Program archived**: Check if program was archived or deleted
2. **Program moved**: Program status changed to private or inactive
3. **Permission changed**: Verify program still allows public enrollment
4. **System issue**: Try refreshing or generate a new link

### Issue: Can't Find Share Link Button

**Symptom**: Don't see the "Generate Share Link" button

**Possible Causes & Solutions**:
1. **Not admin/instructor**: Only program managers can generate links
2. **Program not published**: Publish the program first
3. **Program unpublished**: The program may have been unpublished
4. **UI update**: Refresh the page to see the latest interface

---

## Tips for Maximum Success

✅ **Do This**:
- Generate links for your best programs first
- Test the link before sharing widely
- Track which platforms perform best
- Update program information to optimize for sharing
- Share regularly (not just once)
- Create targeted campaigns for different audiences

❌ **Don't Do This**:
- Share links to inactive or unpublished programs
- Spam the same link repeatedly to the same audience
- Make false promises about program content
- Share to irrelevant audiences
- Forget to test the link works

---

## Need More Help?

If you have additional questions about program sharing:
- Check the [Troubleshooting & FAQ Guide](./TRAINEE_STUDENT_GUIDE.md#troubleshooting)
- Contact your system administrator
- Reach out to support@yourapp.com

**Thank you for using Program Sharing to grow your programs!**

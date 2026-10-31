package org.kongwotv.tv;

import android.app.Activity;
import android.app.Dialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.*;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.*;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.*;
import androidx.media3.common.C;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** TV transport chrome; PlayerView remains only the video output surface. */
@UnstableApi
final class TvPlaybackControls extends FrameLayout implements Player.Listener {
    interface Actions {
        void back(); void togglePlayback(); void changeItem(int offset, boolean fullscreen);
        void select(int index); void seek(long delta); void switchSource(); void resize(boolean fill);
    }
    private static final int WHITE=0xFFF5F5F7, MUTED=0xFFB6B6BE;
    private static final float[] SPEEDS={.5f,.75f,1f,1.25f,1.5f,2f,3f};
    private final Activity activity;
    private final Actions actions;
    private final boolean live;
    private final SharedPreferences prefs;
    private final Handler handler=new Handler(Looper.getMainLooper());
    final LinearLayout top, bottom, transport;
    final TextView title;
    final Button playButton, nextButton, listButton, previousButton;
    private final Button backButton, moreButton, speedButton, resizeButton;
    private final TextView time;
    private final Timeline timeline;
    private final View surface;
    private final ArrayList<String> names=new ArrayList<>();
    private ExoPlayer player;
    private Dialog sheet;
    private View sheetOpener;
    private int index, consumedKey=KeyEvent.KEYCODE_UNKNOWN;
    private boolean chromeVisible=true, suspended=true, fill;
    private Boolean drawnPlaying;
    private final Runnable hide=()->hideChrome();
    private final Runnable tick=new Runnable() {
        @Override public void run() { if(!suspended) { refresh(); handler.postDelayed(this,300); } }
    };

    TvPlaybackControls(Activity activity, boolean live, Actions actions) {
        super(activity); this.activity=activity; this.live=live; this.actions=actions;
        prefs=activity.getSharedPreferences("kongwotv_playback",Context.MODE_PRIVATE);
        fill=prefs.getBoolean("tv_fill",false);
        setTag("tv-player-controls"); setClipChildren(false); setClipToPadding(false);
        surface=new View(activity); surface.setId(View.generateViewId());
        surface.setFocusable(true); surface.setFocusableInTouchMode(true); surface.setTag("tv-player-surface");
        surface.setContentDescription("视频画面，确定键播放或暂停，上下键显示控制，左右键快进快退");
        surface.setOnClickListener(view->toggleFromSurface());
        addView(surface,new LayoutParams(-1,-1));
        top=new LinearLayout(activity); top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(42),dp(28),dp(42),dp(30));
        top.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,new int[]{0xD9000000,0x65000000,Color.TRANSPARENT}));
        backButton=icon("back","返回",()->actions.back()); top.addView(backButton,row(dp(48),dp(48)));
        title=text("",24,WHITE); title.setSingleLine(); title.setEllipsize(TextUtils.TruncateAt.END);
        title.setPadding(dp(16),0,dp(20),0); top.addView(title,new LinearLayout.LayoutParams(0,dp(48),1));
        moreButton=icon("more","更多播放设置",()->showSettings()); top.addView(moreButton,row(dp(48),dp(48)));
        addView(top,new LayoutParams(-1,-2,Gravity.TOP));
        bottom=new LinearLayout(activity); bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setPadding(dp(42),dp(32),dp(42),dp(28)); bottom.setClipChildren(false); bottom.setClipToPadding(false);
        bottom.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,new int[]{Color.TRANSPARENT,0x80000000,0xED000000}));
        timeline=new Timeline(activity); timeline.setTag("tv-player-progress"); bottom.addView(timeline,row(-1,dp(32)));
        transport=new LinearLayout(activity); transport.setTag("tv-player-transport"); transport.setGravity(Gravity.CENTER_VERTICAL); transport.setClipChildren(false);
        transport.setPadding(dp(12),dp(8),dp(12),dp(8));
        transport.setBackground(TvUi.rounded(activity,0xD9111114,18,0x1AFFFFFF,1));
        playButton=icon("pause","暂停",()->{ actions.togglePlayback(); showChrome(); }); playButton.setTag("tv-player-play");
        transport.addView(playButton,row(dp(48),dp(48)));
        nextButton=icon("next",live?"下一频道":"下一集",()->{ actions.changeItem(1,false); showChrome(); }); nextButton.setTag("tv-player-next");
        transport.addView(nextButton,spaced(dp(48),dp(48)));
        time=text(live?"●  直播":"00:00 / 00:00",15,WHITE); time.setPadding(dp(16),0,dp(12),0);
        transport.addView(time,new LinearLayout.LayoutParams(0,dp(48),1));
        speedButton=button("倍速",()->showSpeeds()); speedButton.setTag("tv-player-speed"); transport.addView(speedButton,spaced(dp(82),dp(48)));
        listButton=button(live?"频道":"选集",()->showEpisodes()); listButton.setTag("tv-player-episodes"); transport.addView(listButton,spaced(dp(116),dp(48)));
        resizeButton=button("画面",()->showSettings()); resizeButton.setTag("tv-player-resize"); transport.addView(resizeButton,spaced(dp(82),dp(48)));
        previousButton=button(live?"上一频道":"上一集",()->{ dismissSheet(); actions.changeItem(-1,false); showChrome(); }); previousButton.setTag("tv-player-previous");
        bottom.addView(transport,row(-1,dp(64)));
        TextView hint=text(live?"确定键播放 / 暂停  ·  全屏上下键换台  ·  菜单键选台":"确定键播放 / 暂停  ·  全屏左右键快进 / 快退  ·  菜单键选集",12,MUTED);
        hint.setPadding(dp(8),dp(12),0,0); bottom.addView(hint,row(-1,dp(30)));
        addView(bottom,new LayoutParams(-1,-2,Gravity.BOTTOM));
        if(live) { timeline.setVisibility(GONE); speedButton.setVisibility(GONE); }
        for(Button b:new Button[]{playButton,nextButton,speedButton,listButton,resizeButton}) {
            b.setNextFocusUpId(live?backButton.getId():timeline.getId()); b.setNextFocusDownId(b.getId());
        }
        backButton.setNextFocusDownId(playButton.getId()); moreButton.setNextFocusDownId(resizeButton.getId());
        timeline.setNextFocusUpId(backButton.getId()); timeline.setNextFocusDownId(playButton.getId()); refresh();
    }
    private void toggleFromSurface() { actions.togglePlayback(); showChrome(); playButton.requestFocus(); }
    void bind(ExoPlayer next) {
        if(player!=null) player.removeListener(this);
        handler.removeCallbacksAndMessages(null); player=next; suspended=next==null;
        if(player!=null) {
            float rate=prefs.getFloat("tv_speed",1f); if(Float.isNaN(rate)||Float.isInfinite(rate)) rate=1f;
            player.setPlaybackSpeed(live?1f:Math.max(.5f,Math.min(3f,rate)));
            actions.resize(fill); player.addListener(this); handler.post(tick); showChrome(); playButton.requestFocus();
        }
        refresh();
    }
    void setItem(String heading,List<String> items,int selected) {
        title.setText(heading); names.clear(); names.addAll(items); index=selected;
        previousButton.setEnabled(index>0); nextButton.setEnabled(index+1<names.size());
        listButton.setText((live?"频道 ":"选集 ")+(index+1)+"/"+names.size());
        Button afterNext=live?listButton:speedButton;
        playButton.setNextFocusLeftId(playButton.getId());
        playButton.setNextFocusRightId(nextButton.isEnabled()?nextButton.getId():afterNext.getId());
        nextButton.setNextFocusLeftId(playButton.getId()); nextButton.setNextFocusRightId(afterNext.getId());
        speedButton.setNextFocusLeftId(nextButton.isEnabled()?nextButton.getId():playButton.getId()); speedButton.setNextFocusRightId(listButton.getId());
        listButton.setNextFocusLeftId(live?(nextButton.isEnabled()?nextButton.getId():playButton.getId()):speedButton.getId());
        listButton.setNextFocusRightId(resizeButton.getId()); resizeButton.setNextFocusLeftId(listButton.getId()); resizeButton.setNextFocusRightId(resizeButton.getId());
        backButton.setNextFocusLeftId(backButton.getId()); backButton.setNextFocusRightId(moreButton.getId());
        moreButton.setNextFocusLeftId(backButton.getId()); moreButton.setNextFocusRightId(moreButton.getId()); refresh();
    }
    boolean isChromeVisible() { return chromeVisible; }
    void showChrome() {
        boolean fromSurface=surface.isFocused(); chromeVisible=true;
        top.setVisibility(VISIBLE); bottom.setVisibility(VISIBLE); surface.setFocusable(false);
        if(fromSurface) playButton.requestFocus(); scheduleHide();
    }
    void hideChrome() {
        handler.removeCallbacks(hide); chromeVisible=false; top.setVisibility(GONE); bottom.setVisibility(GONE);
        surface.setFocusable(true); surface.requestFocus();
    }
    private void scheduleHide() {
        handler.removeCallbacks(hide);
        if(!suspended&&chromeVisible&&sheet==null&&player!=null&&player.getPlayWhenReady()) handler.postDelayed(hide,6000);
    }
    boolean handleBack() { if(sheet!=null) { dismissSheet(); return true; } if(chromeVisible) { hideChrome(); return true; } return false; }
    boolean handleKeyEvent(KeyEvent event) {
        int key=event.getKeyCode();
        if(event.getAction()==KeyEvent.ACTION_UP&&key==consumedKey) { consumedKey=KeyEvent.KEYCODE_UNKNOWN; return true; }
        if(event.getAction()!=KeyEvent.ACTION_DOWN||sheet!=null) return false;
        boolean first=event.getRepeatCount()==0; scheduleHide();
        switch(key) {
            case KeyEvent.KEYCODE_BACK: if(first&&!handleBack()) actions.back(); break;
            case KeyEvent.KEYCODE_MENU: if(first) showEpisodes(); break;
            case KeyEvent.KEYCODE_DPAD_CENTER: case KeyEvent.KEYCODE_ENTER:
                if(chromeVisible&&!surface.isFocused()) return false; if(first) toggleFromSurface(); break;
            case KeyEvent.KEYCODE_DPAD_LEFT: case KeyEvent.KEYCODE_DPAD_RIGHT:
                if(chromeVisible&&!timeline.isFocused()&&!surface.isFocused()) return false;
                if(!live) actions.seek(key==KeyEvent.KEYCODE_DPAD_RIGHT?10000:-10000); break;
            case KeyEvent.KEYCODE_DPAD_UP: case KeyEvent.KEYCODE_DPAD_DOWN:
                if(chromeVisible) return false;
                if(first) { if(live) actions.changeItem(key==KeyEvent.KEYCODE_DPAD_UP?-1:1,true); else { showChrome(); playButton.requestFocus(); } } break;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: if(first) { actions.togglePlayback(); showChrome(); } break;
            case KeyEvent.KEYCODE_MEDIA_PLAY: if(player!=null) player.play(); break;
            case KeyEvent.KEYCODE_MEDIA_PAUSE: case KeyEvent.KEYCODE_MEDIA_STOP: if(player!=null) player.pause(); break;
            case KeyEvent.KEYCODE_MEDIA_NEXT: case KeyEvent.KEYCODE_CHANNEL_UP: if(first) actions.changeItem(1,!chromeVisible); break;
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS: case KeyEvent.KEYCODE_CHANNEL_DOWN: if(first) actions.changeItem(-1,!chromeVisible); break;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: case KeyEvent.KEYCODE_MEDIA_REWIND:
                if(!live) actions.seek(key==KeyEvent.KEYCODE_MEDIA_FAST_FORWARD?10000:-10000); break;
            default: return false;
        }
        consumedKey=key; return true;
    }
    private void refresh() {
        boolean playing=player!=null&&player.getPlayWhenReady()&&player.getPlaybackState()!=Player.STATE_ENDED;
        if(drawnPlaying==null||drawnPlaying!=playing) {
            playButton.setCompoundDrawablesWithIntrinsicBounds(new Icon(playing?"pause":"play"),null,null,null);
            playButton.setContentDescription(playing?"暂停":"播放"); drawnPlaying=playing;
        }
        long duration=player==null||player.getDuration()==C.TIME_UNSET?0:Math.max(0,player.getDuration());
        long position=player==null?0:Math.max(0,player.getCurrentPosition());
        time.setText(live?"●  直播":format(position)+" / "+format(duration));
        timeline.duration=duration; timeline.position=position; timeline.buffered=player==null?0:player.getBufferedPosition();
        timeline.setEnabled(!live&&duration>0&&player!=null&&player.isCurrentMediaItemSeekable());
        timeline.setContentDescription("播放进度 "+format(position)+"，共 "+format(duration)+"，左右键调整十秒"); timeline.invalidate();
        float rate=player==null?prefs.getFloat("tv_speed",1f):player.getPlaybackParameters().speed;
        speedButton.setText(rate==1f?"倍速":rateLabel(rate)+"x"); resizeButton.setText(fill?"铺满":"画面");
    }
    @Override public void onEvents(Player p,Player.Events events) {
        refresh();
        if(events.contains(Player.EVENT_PLAY_WHEN_READY_CHANGED)) { if(!p.getPlayWhenReady()) showChrome(); else scheduleHide(); }
        else if(events.contains(Player.EVENT_PLAYBACK_STATE_CHANGED)&&p.getPlaybackState()==Player.STATE_ENDED) showChrome();
    }
    void showEpisodes() {
        if(names.isEmpty()) return;
        LinearLayout rows=panel((live?"选择频道":"选择剧集")+"  "+(index+1)+"/"+names.size()); Button selected=null;
        for(int i=0;i<names.size();i++) {
            final int target=i;
            Button option=option(rows,names.get(i)+(i==index?"  ·  正在播放":""),i==index,()->{ dismissSheet(); actions.select(target); showChrome(); });
            option.setTag("tv-episode-"+i); if(i==index) selected=option;
        }
        showSheet(rows,selected,listButton);
    }
    private void showSpeeds() {
        if(live||player==null) return;
        LinearLayout rows=panel("播放速度"); Button selected=null; float current=player.getPlaybackParameters().speed;
        for(float rate:SPEEDS) {
            Button option=option(rows,rateLabel(rate)+"x"+(rate==1?"  正常":""),Math.abs(rate-current)<.01f,()->{
                if(player!=null) player.setPlaybackSpeed(rate); prefs.edit().putFloat("tv_speed",rate).apply(); dismissSheet(); refresh();
            });
            option.setTag("tv-speed-"+rateLabel(rate)); if(Math.abs(rate-current)<.01f) selected=option;
        }
        showSheet(rows,selected,speedButton);
    }
    private void showSettings() {
        LinearLayout rows=panel("播放设置");
        Button fit=option(rows,"适应画面",!fill,()->setFill(false)); fit.setTag("tv-resize-fit");
        Button zoom=option(rows,"铺满屏幕 · 可能裁切",fill,()->setFill(true)); zoom.setTag("tv-resize-fill");
        if(previousButton.getParent() instanceof ViewGroup) ((ViewGroup)previousButton.getParent()).removeView(previousButton);
        rows.addView(previousButton,optionParams());
        Button source=option(rows,"返回更换播放源",false,()->{ dismissSheet(); actions.switchSource(); }); source.setTag("tv-switch-source");
        TextView help=text("左右键：全屏或进度条快进 / 快退\n确定键：播放 / 暂停\n菜单键：选集 / 频道\n返回键：先收起面板与控制栏",13,MUTED);
        help.setLineSpacing(dp(7),1); help.setPadding(dp(12),dp(20),dp(8),dp(12)); rows.addView(help);
        showSheet(rows,fill?zoom:fit,moreButton.isFocused()?moreButton:resizeButton);
    }
    private void setFill(boolean value) { fill=value; prefs.edit().putBoolean("tv_fill",value).apply(); actions.resize(value); dismissSheet(); refresh(); }
    private LinearLayout panel(String heading) {
        handler.removeCallbacks(hide); LinearLayout rows=new LinearLayout(activity); rows.setOrientation(LinearLayout.VERTICAL);
        rows.setPadding(dp(28),dp(32),dp(28),dp(32)); TextView label=text(heading,26,WHITE); label.setPadding(dp(10),dp(10),0,dp(26)); rows.addView(label); return rows;
    }
    private Button option(LinearLayout rows,String label,boolean selected,Runnable action) {
        Button b=button((selected?"✓  ":"")+label,action); b.setSelected(selected); b.setGravity(Gravity.CENTER_VERTICAL);
        b.setTextColor(new ColorStateList(new int[][]{{android.R.attr.state_focused},{android.R.attr.state_selected},{}},new int[]{0xFF17171C,WHITE,WHITE}));
        rows.addView(b,optionParams()); return b;
    }
    private void showSheet(LinearLayout rows,View selected,View opener) {
        dismissSheet(); handler.removeCallbacks(hide); sheetOpener=opener;
        Dialog dialog=new Dialog(activity); sheet=dialog; dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        ScrollView scroll=new ScrollView(activity); scroll.setFillViewport(true); scroll.setBackgroundColor(TvUi.SURFACE); scroll.setClipToPadding(false); scroll.addView(rows); dialog.setContentView(scroll);
        final boolean[] menuDownInSheet={false};
        dialog.setOnKeyListener((owner,key,event)->{
            if(key==KeyEvent.KEYCODE_BACK) { if(event.getAction()==KeyEvent.ACTION_UP) dismissSheet(); return true; }
            if(key!=KeyEvent.KEYCODE_MENU) return false;
            if(event.getAction()==KeyEvent.ACTION_DOWN) menuDownInSheet[0]=true;
            else if(event.getAction()==KeyEvent.ACTION_UP&&menuDownInSheet[0]) dismissSheet();
            return true;
        });
        dialog.setOnDismissListener(owner->{ if(sheet==dialog) { sheet=null; restoreSheetFocus(); } });
        dialog.show(); Window window=dialog.getWindow();
        if(window!=null) { window.setBackgroundDrawableResource(android.R.color.transparent); window.setDimAmount(.35f); window.setGravity(Gravity.END); window.setLayout(Math.min(dp(380),Math.round(getWidth()*.48f)),-1); window.getDecorView().setSystemUiVisibility(activity.getWindow().getDecorView().getSystemUiVisibility()); }
        View target=selected==null?rows.getChildAt(1):selected; target.requestFocus();
        target.post(()->{ target.requestFocus(); target.requestRectangleOnScreen(new android.graphics.Rect(0,0,target.getWidth(),target.getHeight()),false); });
    }
    private void restoreSheetFocus() {
        if(suspended) return;
        showChrome(); View focus=sheetOpener;
        if(focus!=null&&focus.isEnabled()) focus.requestFocus(); else playButton.requestFocus();
    }
    void dismissSheet() { if(sheet!=null) { Dialog old=sheet; sheet=null; old.dismiss(); restoreSheetFocus(); } }
    void suspend() { suspended=true; handler.removeCallbacksAndMessages(null); dismissSheet(); consumedKey=KeyEvent.KEYCODE_UNKNOWN; }
    private Button button(String value,Runnable action) {
        Button b=new Button(activity); b.setId(View.generateViewId()); b.setText(value); b.setTextSize(15); b.setAllCaps(false); b.setSingleLine(); b.setEllipsize(TextUtils.TruncateAt.END);
        b.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL)); b.setIncludeFontPadding(false);
        b.setMinWidth(0); b.setMinimumWidth(0); b.setMinHeight(0); b.setMinimumHeight(0); b.setPadding(dp(12),0,dp(12),0); b.setGravity(Gravity.CENTER);
        b.setTextColor(new ColorStateList(new int[][]{{-android.R.attr.state_enabled},{android.R.attr.state_focused},{}},new int[]{0xFF73737F,0xFF17171C,WHITE}));
        b.setBackground(TvUi.focusBackground(activity,Color.TRANSPARENT)); b.setStateListAnimator(null); b.setFocusable(true);
        b.setOnClickListener(view->{ handler.removeCallbacks(hide); action.run(); scheduleHide(); }); b.setOnFocusChangeListener((view,focused)->{ TvUi.animateFocus(view,focused,1.06f); scheduleHide(); }); return b;
    }
    private Button icon(String name,String description,Runnable action) { Button b=button("",action); b.setCompoundDrawablesWithIntrinsicBounds(new Icon(name),null,null,null); b.setContentDescription(description); return b; }
    private TextView text(String value,int size,int color) { TextView t=TvUi.heading(activity,value,size); t.setTextColor(color); t.setGravity(Gravity.CENTER_VERTICAL); return t; }
    private int dp(int value) { return TvUi.dp(activity,value); }
    private LinearLayout.LayoutParams row(int w,int h) { return new LinearLayout.LayoutParams(w,h); }
    private LinearLayout.LayoutParams spaced(int w,int h) { LinearLayout.LayoutParams p=row(w,h); p.leftMargin=dp(10); return p; }
    private LinearLayout.LayoutParams optionParams() { LinearLayout.LayoutParams p=row(-1,dp(52)); p.topMargin=dp(8); return p; }
    private static String rateLabel(float rate) { return String.format(Locale.ROOT,"%.2f",rate).replaceAll("0+$","").replaceAll("\\.$",""); }
    private static String format(long ms) { long s=Math.max(0,ms/1000); return s>=3600?String.format(Locale.ROOT,"%d:%02d:%02d",s/3600,s/60%60,s%60):String.format(Locale.ROOT,"%02d:%02d",s/60,s%60); }

    private final class Timeline extends View {
        final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG); final RectF outline=new RectF(); long duration,position,buffered;
        Timeline(Context context) { super(context); setId(View.generateViewId()); setFocusable(true); }
        @Override protected void onFocusChanged(boolean focused,int direction,android.graphics.Rect old) { super.onFocusChanged(focused,direction,old); invalidate(); scheduleHide(); }
        @Override protected void onDraw(Canvas canvas) {
            float left=dp(8),right=getWidth()-dp(8),y=getHeight()/2f,h=dp(isFocused()?3:2);
            if(isFocused()) { paint.setColor(0x24FFFFFF); outline.set(0,dp(2),getWidth(),getHeight()-dp(2)); canvas.drawRoundRect(outline,dp(8),dp(8),paint); }
            paint.setColor(0x55FFFFFF); canvas.drawRect(left,y-h/2,right,y+h/2,paint);
            paint.setColor(0x99FFFFFF); canvas.drawRect(left,y-h/2,left+fraction(buffered)*(right-left),y+h/2,paint);
            float x=left+fraction(position)*(right-left); paint.setColor(WHITE); canvas.drawRect(left,y-h/2,x,y+h/2,paint);
            paint.setColor(WHITE); canvas.drawCircle(x,y,dp(isFocused()?5:3),paint);
        }
        private float fraction(long value) { return duration>0?Math.max(0,Math.min(1,(float)value/duration)):0; }
        @Override public void onInitializeAccessibilityNodeInfo(AccessibilityNodeInfo info) { super.onInitializeAccessibilityNodeInfo(info); info.setClassName("android.widget.SeekBar"); if(isEnabled()) { info.addAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD); info.addAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD); } }
        @Override public boolean performAccessibilityAction(int action,Bundle arguments) {
            if(isEnabled()&&(action==AccessibilityNodeInfo.ACTION_SCROLL_FORWARD||action==AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)) { actions.seek(action==AccessibilityNodeInfo.ACTION_SCROLL_FORWARD?10000:-10000); return true; }
            return super.performAccessibilityAction(action,arguments);
        }
    }
    private final class Icon extends Drawable {
        final String name; final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG); final Path path=new Path(); final RectF bounds=new RectF(); int alpha=255;
        Icon(String name) { this.name=name; }
        @Override public boolean isStateful() { return true; }
        @Override protected boolean onStateChange(int[] state) { invalidateSelf(); return true; }
        @Override public void draw(Canvas canvas) {
            boolean focused=false,enabled=false; for(int s:getState()) { if(s==android.R.attr.state_focused) focused=true; if(s==android.R.attr.state_enabled) enabled=true; }
            paint.setColor(focused?0xFF17171C:WHITE); paint.setAlpha(enabled?alpha:Math.min(alpha,90)); paint.setStrokeWidth(1.8f); paint.setStrokeCap(Paint.Cap.ROUND); paint.setStrokeJoin(Paint.Join.ROUND); paint.setStyle(Paint.Style.STROKE);
            canvas.save(); canvas.translate(getBounds().left,getBounds().top); canvas.scale(getBounds().width()/24f,getBounds().height()/24f); Path p=path; p.reset();
            if(name.equals("back")) { p.moveTo(15,4); p.lineTo(7,12); p.lineTo(15,20); canvas.drawPath(p,paint); }
            else if(name.equals("more")) { paint.setStyle(Paint.Style.FILL); for(int x=5;x<=19;x+=7) canvas.drawCircle(x,12,1.5f,paint); }
            else if(name.equals("pause")) { paint.setStyle(Paint.Style.FILL); bounds.set(5,4,9,20); canvas.drawRoundRect(bounds,1,1,paint); bounds.set(15,4,19,20); canvas.drawRoundRect(bounds,1,1,paint); }
            else { p.moveTo(6,4); p.lineTo(19,12); p.lineTo(6,20); p.close(); paint.setStyle(Paint.Style.FILL); canvas.drawPath(p,paint); if(name.equals("next")) canvas.drawRect(19,4,21,20,paint); }
            canvas.restore();
        }
        @Override public int getIntrinsicWidth() { return dp(24); }
        @Override public int getIntrinsicHeight() { return dp(24); }
        @Override public void setAlpha(int value) { alpha=value; invalidateSelf(); }
        @Override public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); invalidateSelf(); }
        @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
    }
}

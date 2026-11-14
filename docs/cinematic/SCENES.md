# EGIZ — ONE SHOT · Сценарий, ключевые кадры (Nano Banana) и видео (Veo 3.1)

> AI-assisted; human review pending. All footage is illustrative and labelled on the site. No real
> missions, crews, agencies, logos or rovers are depicted.

## Идея

**Один непрерывный полёт камеры длиной 56 секунд.** Семь клипов Veo по 8 секунд склеены так,
что последний кадр каждого клипа совпадает с первым кадром следующего. Зритель не видит ни одной
склейки: камера летит от Луны к Земле, обратно к Луне, к Марсу, а над кратером Езеро, не
останавливаясь, Марс превращается в свой земной двойник. Оттуда камера поднимается домой, на орбиту.

Это и есть то, что делает EGIZ, рассказанное одним движением камеры: **указать на чужую планету — и
найти ту же почву на Земле.**

### Сценарий

| Клип | Кадры | Что происходит | Где на сайте |
|---|---|---|---|
| **S1 · Прибытие** | K0 → K1 | Чёрный космос. Из темноты выходит край Луны, рассвет бежит по нему тонкой белой линией. Камера пикирует к южному полюсу и выравнивается на высоте 600 м над кратерами; на горизонте висит голубая Земля. | Первый экран. Ролик играет один раз и растворяется в живой 3D-Луне. |
| **S2 · Двойник** | K1 → K2 | Камера продолжает скользить над кратерами, и прямо в движении кратеры становятся полигонами соляной корки, чёрное небо голубеет. Мы на Земле, в Долине Смерти, на закате; впереди идут два человека в полевых костюмах. | Переход к главе «Двойник» (перемотка скроллом). |
| **S3 · Возвращение** | K2 → K3 | Камера поднимается над солончаком, голубое небо гаснет в черноту, соль снова становится реголитом. Мы на краю кратера у Монс-Мутон, Солнце ползёт по горизонту, тени тянутся на километры. | Переход к главе «Луна» (скролл). |
| **S4 · Перелёт** | K3 → K4 | Камера отрывается от Луны, разгоняется в черноту; растёт Марс, и мы входим в его пыльную атмосферу. Слои золотой дымки расходятся над кратером Езеро. | Переход Луна → Марс (скролл). |
| **S5 · Езеро** | K4 → K5 | Низкий полёт над слоистыми уступами древней дельты к голубому марсианскому закату; на горизонте стоят пылевые вихри. | Глава «Марс», чистое кино (скролл). |
| **S6 · Ответ** | K5 → K6 | Та же камера над тем же рельефом, но планета меняется прямо в полёте: марсианский закат становится земным, слоистый уступ — исландским лавовым обрывом со мхом, тёмный песок — чёрным вулканическим. Тот же грунт, только на Земле. | Открывает главу «Одна почва, две планеты», затем живой интерактив сравнения. |
| **S7 · Дом** | K6 → K8 | Камера поднимает взгляд от чёрного песка и взмывает сквозь закатные облака на орбиту: тонкая линия атмосферы, над ней Луна. | Финал (скролл). |

Ритм: огромное (S1) → узнавание (S2) → тишина (S3) → скорость (S4) → красота (S5) → ответ (S6) → дом (S7).

---

## Как делать (важно для непрерывности)

1. **Keyframes в Nano Banana, строго по порядку K0 → K6, затем K8** (K7 не нужен). K0 генерируйте с нуля. Каждый
   следующий кадр генерируйте, **приложив предыдущий как референс** (промт начинается словами *Using the
   attached image as the previous frame…*). Так сохраняются свет, зерно и цвет. Формат 16:9,
   от 1920×1080. Выбирайте кадр, а не вариант: лучше скучнее, но точнее по описанию.
2. **Veo 3.1 в Flow, режим Frames to Video:** First frame = Kn, Last frame = Kn+1, длина 8 с, 16:9,
   720p (черновик можно сделать в Fast). Вставьте VIDEO PROMPT. Звук Veo мы не используем: у сайта свой
   звук, который включается по желанию.
3. **Перекодировать и положить в папку** (команды в конце файла). Имена файлов указаны у каждого клипа.

Общий негатив (добавляйте к каждому промту):
```
no text, no captions, no logos, no flags, no mission patches, no UI, no HUD, no holograms, no neon,
no lens flare streaks, no glowing particles, no camera shake, no fisheye, no oversharpening, no noisy
or pixelated terrain, no plastic CG look, no cartoon, no flicker, no recognisable real person,
no real rover, no watermark, no cuts, one continuous shot
```

Общий стиль (добавляйте в конец каждого промта картинки):
```
Photoreal, shot like a high-end space documentary on large-format digital cinema camera, natural
light, soft highlight roll-off, deep shadows that keep faint detail, fine organic film grain, 16:9.
```

---

## Ключевые кадры · Nano Banana

### K0 · Тьма и край Луны
```
Deep black space. In the lower third of the frame, the curved dark limb of the Moon seen from
orbit, almost entirely in shadow; along its edge a razor-thin line of first sunlight catches the
tops of crater rims near the south pole, like a sliver of silver. A few faint stars. The rest of
the frame is pure black. Cinematic, 50 mm, the horizon line gently curved across the lower third.
```

### K1 · Над южным полюсом Луны (используйте K0 как референс)
```
Using the attached image as the previous frame: the camera has descended to 600 metres above the
lunar south pole highlands at sunrise. A cratered plain stretches to the horizon, hundreds of
craters of every size; a broad flat-topped mountain on the right catches hard white sunlight while
the foreground plain is still half in long black shadow. The Sun is a tiny blinding point on the
horizon behind the mountain. Pitch-black sky. A thin blue crescent of Earth hangs low in the upper
right. No air, perfect clarity. 35 mm, horizon on the upper quarter, left side of frame darker.
Warm-grey regolith, shadows with faint blue earthshine.
```

### K2 · Долина Смерти — двойник (используйте K1 как референс)
```
Using the attached image as the previous frame, keep the same camera height, lens, horizon line
and sun direction: we are now on Earth over a vast white desert salt flat at dusk. The craters have
become raised polygonal salt crust that from a distance still resembles a cratered plain. The
flat-topped mountain is now a dark banded desert range in the same position on the right. The black
sky has become deep blue fading to pale gold at the horizon. Two small figures in pale grey field
suits with backpacks walk away from the camera in the right third, long shadows across the salt.
```

### K3 · Край кратера у Монс-Мутон (используйте K2 как референс)
```
Using the attached image as the previous frame, keep the horizon line: we are back on the Moon,
on the rim of a deep crater near the south pole, camera 40 metres above the rim looking across the
crater. Terraced inner walls, talus and boulders; the crater floor completely black in permanent
shadow. The Sun skims the horizon at the far left, two degrees high, and every ridge casts a shadow
kilometres long to the right. Pitch-black sky. 24 mm.
```

### K4 · Над кратером Езеро (используйте K3 как референс по свету и зерну)
```
Using the attached image as a reference for grain and grade: aerial view 1.5 km above the floor
of a vast Martian crater in the late afternoon. Thin layers of glowing butterscotch dust haze drift
below the camera, parting to reveal an ancient fan-shaped river delta with layered sediment and
winding dry channels, dark basaltic sand dunes, and the crater rim on the horizon. Low warm sun from
behind the camera. Ochre and rust, shadows brown-violet. 28 mm, horizon on the upper fifth.
```

### K5 · Дельта на закате (используйте K4 как референс)
```
Using the attached image as the previous frame: the camera is now 25 metres above the crater
floor at sunset, flying toward the small setting Sun over the western rim. A tall eroded scarp of
stacked sedimentary layers on the right, dark sand ripples and scattered boulders with glowing rims
of backlight in the foreground. The Sun sits inside a pale blue-white aureole; the sky is
butterscotch above and blue around the Sun; the ground goes violet in long shadows. Three thin dust
devils stand far away on the horizon. 35 mm, left side darker.
```

### K6 · Земной двойник (используйте K5 как референс)
```
Using the attached image as the previous frame of the same continuous shot, keep exactly the same camera position, height, 35 mm lens, horizon line, composition and sun direction, and keep the same terrain layout: the same scarp on the right, the same ripples and boulders in the same places, the same rim line on the horizon. Only the planet has changed: we are now on Earth, in an Iceland-like volcanic landscape at sunset. The layered Martian scarp is now a cliff of stacked dark lava and tuff layers, banded in charcoal, rust-brown and grey, with thin streaks of green moss on its ledges. The dark sand ripples are now black volcanic sand with fine wind ripples and a few tufts of pale grass; the boulders are dark basalt with soft rims of warm light. The distant rim is now a low ridge of volcanic mountains with a white glacier edge. The sky is an Earth sunset: a larger golden Sun on the horizon, a warm gold-to-peach glow, soft pink and lilac high clouds, deep blue above. Thin mist lies in the low ground. No dust devils. Photoreal landscape cinematography, large-format cinema camera, natural light, fine film grain, soft highlight roll-off, shadows keep detail. Avoid: text, logos, people, buildings, roads, vehicles, lens flare streaks, oversaturated colours, oversharpening, CGI look, cartoon style, watermark.
```

### K8 · Дом (используйте K6 как референс по свету и зерну)
```
Using the attached image as a reference for grade and grain: photograph from low Earth orbit with
a long telephoto lens. Earth's limb at twilight across the lower third, a razor-thin glowing shell
of atmosphere in bands of deep orange, cream, blue and violet above the dark night side with faint
city lights; the Moon, a sharp white disc, just above the shell in black space. 200 mm.
```

---

## Видео · Veo 3.1 (8 с, First frame → Last frame)

### S1 · Прибытие — K0 → K1 · `hero/s1-arrival`
```
One continuous shot. From deep black space the camera glides down toward the dark limb of the
Moon as sunrise races along its edge as a razor-thin silver line. The camera keeps descending in a
smooth, heavy arc toward the south pole until it levels out 600 metres above a cratered plain:
crater rims light up one after another like a fuse, long black shadows retreat into crater floors,
a flat-topped mountain on the right is lit first, and a thin blue Earth crescent settles low on the
horizon. Black sky, no air, perfectly sharp. Slow, majestic, documentary realism. Silence, no music.
```

### S2 · Двойник — K1 → K2 · `earth/s2-twin`
```
One continuous shot, steady forward glide at constant height. The cratered lunar plain flowing
beneath the camera gradually becomes a white desert salt flat: craters soften into polygonal salt
crust, the flat-topped mountain becomes a banded desert range, and the black sky slowly warms into
deep blue with a pale gold horizon, as if the world quietly changes under the camera without a cut.
Two small figures in pale field suits come into view ahead, walking away toward the range, their
long shadows stretching across the salt. Natural, seamless, photoreal. Ambient desert wind only.
```

### S3 · Возвращение — K2 → K3 · `moon/s3-return`
```
One continuous shot. The camera rises slowly over the salt flat and the two walkers fall behind;
the blue sky drains to black, stars appear, and the salt crust turns back into grey regolith as the
ground falls away into a deep crater. The camera settles on the crater rim at the lunar south pole:
the Sun skims the horizon on the left, shadows of every ridge stretch kilometres to the right, and the
crater floor stays completely dark. Calm, mysterious, photoreal. Near silence.
```

### S4 · Перелёт — K3 → K4 · `transitions/s4-passage`
```
One continuous shot. The camera lifts off the lunar rim and accelerates smoothly into black space;
the Moon drops away below; a rust-red Mars swells ahead and fills the frame; the camera plunges into
its atmosphere through glowing layers of butterscotch dust haze that stream past the lens and part
like curtains, revealing far below a vast crater with an ancient fan-shaped delta. Fast but smooth,
no shake, photoreal. Deep low rumble rising to wind.
```

### S5 · Езеро — K4 → K5 · `mars/s5-jezero`
```
One continuous shot. The camera descends from the dust haze and glides low, 25 metres above the
crater floor, toward the small setting Sun: a tall scarp of stacked sedimentary layers passes on the
right, boulders glow with thin rims of backlight, dark sand ripples flow beneath. The Sun sinks
into a pale blue aureole in a butterscotch sky, the ground turns violet in long shadows, and thin dust
devils stand on the far horizon. Monumental, calm, photoreal. Soft thin wind.
```

### S6 · Ответ — K5 → K6 · `missions/s6-answer`
```
One continuous 8-second shot with no cuts, photoreal landscape cinematography, 35 mm lens, steady slow forward glide 25 metres above the ground toward the setting Sun. 0–3 s: Mars at sunset, a layered scarp on the right, dark sand ripples and backlit boulders, the small Sun in a pale blue aureole, dust devils on the horizon. 3–6 s: without any cut and without changing the shape of the land, the planet changes under the camera: the butterscotch sky warms into an Earth sunset of gold, peach and lilac clouds, the Sun grows larger and golden, the scarp darkens into stacked lava and tuff layers with green moss on the ledges, the sand turns into black volcanic sand with tufts of pale grass, the dust devils dissolve into low mist, and a glacier edge appears on the distant ridge. 6–8 s: we are on Earth, in an Iceland-like volcanic landscape, the same ground in the same place. Keep the terrain rigid and physically stable; only colour, material and sky change. Audio: thin Martian wind turning into a soft Earth breeze with distant birds, no music, no voices. Avoid: cuts, flicker, melting or wobbling geometry, people, text, logos, CGI look.
```

### S7 · Дом — K6 → K8 · `orbital/s7-home`
```
One continuous 8-second shot with no cuts, photoreal cinematic and space documentary film. 0–2 s: over the Iceland-like volcanic landscape at sunset, the camera tilts up from the black sand and lava cliffs and begins to rise straight up. 2–5 s: it climbs faster and faster through a layer of soft pink and gold sunset clouds; the land shrinks below into a coastline and glaciers. 5–8 s: it keeps climbing into black space until Earth's limb appears across the lower third as a razor-thin glowing shell of orange, cream and blue above the darkening night side with faint city lights, and the Moon, a sharp white disc, rests just above it. Camera motion: one smooth continuous upward path, majestic, no shake, no spinning. Audio: breeze rising into rushing wind, then fading to complete silence, no music, no voices. Avoid: cuts, flicker, warp streaks, lens flare streaks, spacecraft, satellites, text, logos, CGI look.
```

---

## Перекодирование## Перекодирование

Установите ffmpeg один раз: `winget install Gyan.FFmpeg`. Затем для каждого клипа (замените `IN.mp4`
и `NAME`):

**S1, S6** (обычное воспроизведение):
```bash
ffmpeg -i IN.mp4 -an -vf "scale=1280:-2:flags=lanczos" -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -movflags +faststart NAME.mp4
```

**S2, S3, S4, S5, S7** (перемотка скроллом: нужен частый ключевой кадр, иначе прокрутка дёргается):
```bash
ffmpeg -i IN.mp4 -an -vf "scale=1280:-2:flags=lanczos" -c:v libx264 -preset slow -crf 22 -g 4 -keyint_min 4 -pix_fmt yuv420p -movflags +faststart NAME.mp4
```

**Постер для каждого клипа** (первый кадр):
```bash
ffmpeg -i IN.mp4 -vf "select=eq(n\,0),scale=1600:-2:flags=lanczos" -frames:v 1 -q:v 3 NAME.jpg
```

Если видео ещё нет, положите нужный keyframe как `NAME.jpg`: сайт покажет его как кадр.
- S1 → K0
- S2 → K1
- S3 → K2
- S4 → K3
- S5 → K4
- S6 → K5
- S7 → K6

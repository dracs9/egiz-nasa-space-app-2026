# EGIZ — ONE SHOT · Сценарий, ключевые кадры (Nano Banana) и видео (Veo 3.1)

> AI-assisted; human review pending. All footage is illustrative and labelled on the site. No real
> missions, crews, agencies, logos or rovers are depicted.

## Идея

**Один непрерывный полёт камеры длиной 64 секунды.** Восемь клипов Veo по 8 секунд склеены так,
что последний кадр каждого клипа совпадает с первым кадром следующего. Зритель не видит ни одной
склейки: камера летит от Луны к Земле, обратно к Луне, к Марсу, а потом выясняется, что Марс — это
макет на столе, на который указывает человеческая рука. Карта превращается в Землю, и камера
поднимается домой, на орбиту.

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
| **S6 · Указание** | K5 → K6 | Камера отъезжает назад и вверх, и оказывается, что дельта — это рельефный макет на столе в тёмной комнате. В кадр входит рука и указывает на кратер. Пауза: человек думает. | Открывает главу «Одна почва, две планеты». |
| **S7 · Ответ** | K6 → K7 | Рельеф Марса оседает и поворачивается, на его месте поднимается земное лавовое плато. Палец скользит и останавливается на месте-двойнике. | Сразу после S6, затем живой интерактив сравнения. |
| **S8 · Дом** | K7 → K8 | Камера падает в макет, и он становится настоящей Землёй. Камера взмывает сквозь облака на орбиту: тонкая линия атмосферы, сквозь которую восходит Луна. | Финал (скролл). |

Ритм: огромное (S1) → узнавание (S2) → тишина (S3) → скорость (S4) → красота (S5) → человек
(S6) → ответ (S7) → дом (S8).

---

## Как делать (важно для непрерывности)

1. **Keyframes в Nano Banana, строго по порядку K0 → K8.** K0 генерируйте с нуля. Каждый
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

### K6 · Это макет (используйте K5 как референс)
```
Using the attached image as the previous frame: the camera has pulled far back and up, and the
Martian landscape is revealed to be a large, extremely detailed physical relief model on a table in
a dark room: the same crater, delta and layered scarp, now a sculpted ochre and rust relief lit by a
single warm overhead light, soft shadows showing height. A human hand in a dark wool sleeve enters
from the right and points at the crater with an index finger, fingertip in sharp focus. The room
falls into warm black. 50 mm, shallow depth of field, 70 cm above the table, 35 degrees down.
```

### K7 · Земной двойник на макете (используйте K6 как референс)
```
Using the attached image as the previous frame, same table, light, hand and camera: the relief
model now shows Earth instead of Mars, a volcanic highland with dark lava fields, young cones,
moss-green gentle ground and a glacier edge, sculpted in basalt grey, olive and white. The same index
finger now rests on one lava plateau, in sharp focus; the rest of the model softly out of focus.
No text, no screens.
```

### K8 · Дом (используйте K7 как референс по свету и зерну)
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

### S6 · Указание — K5 → K6 · `missions/s6-pointing`
```
One continuous shot. The camera pulls back and up from the Martian sunset, faster and faster,
and the landscape is revealed to be a large, extremely detailed physical relief model on a table in
a dark room lit by a single warm overhead light. A human hand in a dark wool sleeve enters from the
right and points at the crater with an index finger, then pauses there, thinking. Gentle rack focus
to the fingertip. Quiet, intimate, photoreal, 50 mm, shallow depth of field. Room tone only.
```

### S7 · Ответ — K6 → K7 · `missions/s7-answer`
```
One continuous shot, camera almost still with a slow push toward the fingertip. On the table the
Martian relief model slowly transforms: the crater and delta sink and rotate away and an Earth
volcanic highland rises in their place, dark lava fields, young cones, moss-green ground and a glacier
edge. The index finger slides across the new terrain and comes to rest on one lava plateau. Warm
overhead light, dark room, shallow depth of field, photoreal, no text, no screens. Soft room tone.
```

### S8 · Дом — K7 → K8 · `orbital/s8-home`
```
One continuous shot. The camera dives toward the fingertip and into the relief model, which
becomes real Earth terrain, lava fields and moss under a real sky; without stopping, the camera
rises straight up through a layer of clouds and keeps climbing into black space until Earth's limb
appears as a razor-thin glowing line of orange, cream and blue, with the Moon, a sharp white disc,
resting just above it. Smooth, majestic, photoreal. Wind fading to silence.
```

---

## Перекодирование

Установите ffmpeg один раз: `winget install Gyan.FFmpeg`. Затем для каждого клипа (замените `IN.mp4`
и `NAME`):

**S1, S6, S7** (обычное воспроизведение):
```bash
ffmpeg -i IN.mp4 -an -vf "scale=1280:-2:flags=lanczos" -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -movflags +faststart NAME.mp4
```

**S2, S3, S4, S5, S8** (перемотка скроллом: нужен частый ключевой кадр, иначе прокрутка дёргается):
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
- S8 → K7

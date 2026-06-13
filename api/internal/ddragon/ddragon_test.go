package ddragon

import "testing"

func TestCdragonAsset(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "skin tile path is lowercased under the CDN root",
			in:   "/lol-game-data/assets/ASSETS/Characters/Aatrox/Skins/Skin01/Images/aatrox_splash_tile_1.jpg",
			want: cdragonBase + "/assets/characters/aatrox/skins/skin01/images/aatrox_splash_tile_1.jpg",
		},
		{
			name: "monkeyking path is served as-is (no champion alias hack needed)",
			in:   "/lol-game-data/assets/ASSETS/Characters/MonkeyKing/Skins/Skin01/monkeykingloadscreen_1.jpg",
			want: cdragonBase + "/assets/characters/monkeyking/skins/skin01/monkeykingloadscreen_1.jpg",
		},
		{name: "empty path yields empty url", in: "", want: ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := cdragonAsset(c.in); got != c.want {
				t.Errorf("cdragonAsset(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

// The skin id encodes champion key and skin number: id = key*1000 + num.
// The importer relies on this to map Community Dragon skins onto champions.
func TestSkinIDMath(t *testing.T) {
	cases := []struct {
		id      int
		wantKey int
		wantNum int
	}{
		{266001, 266, 1}, // Justicar Aatrox
		{266000, 266, 0}, // base Aatrox
		{62001, 62, 1},   // Volcanic Wukong (champion key 62 = MonkeyKing)
	}
	for _, c := range cases {
		if key, num := c.id/1000, c.id%1000; key != c.wantKey || num != c.wantNum {
			t.Errorf("id %d → key %d num %d, want key %d num %d", c.id, key, num, c.wantKey, c.wantNum)
		}
	}
}
